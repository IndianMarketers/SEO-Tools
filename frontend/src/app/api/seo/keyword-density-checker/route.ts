import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/seo/safeFetch';
import { classifyAndSanitizeError } from '@/lib/seo/errorSanitizer';
import {
  isBrowserRenderAvailable,
  getBrowserRenderProvider,
} from '@/lib/seo/fetch-render/browserRenderProvider';
import { getFetchRenderUserAgent } from '@/lib/seo/fetch-render/fetchRenderUserAgents';
import { extractHtmlForKeywordDensity } from '@/lib/seo/keyword-density/htmlExtractor';
import { analyzePlainText, analyzeSegments } from '@/lib/seo/keyword-density/analyzer';
import type { ContentScope, ExtractionMethod } from '@/lib/seo/keyword-density/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PASTED_TEXT_CHARS = 100_000;
const MAX_URL_LENGTH = 2048;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 MB

// Lightweight sliding-window rate limiter (20 requests/min per IP)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const ipRequests = new Map<string, number[]>();

function getClientIp(headers: Headers): string {
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const xRealIp = headers.get('x-real-ip');
  if (xRealIp) return xRealIp.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return '127.0.0.1';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (ipRequests.get(ip) || []).filter((ts) => ts > cutoff);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    ipRequests.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  if (ipRequests.size > 5000) {
    ipRequests.clear();
  }
  ipRequests.set(ip, timestamps);
  return true;
}

function normalizeInputUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // If protocol is missing (and not another explicit scheme like ftp:// or javascript:), prepend https://
  if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isSupportedHtmlContentType(contentType: string): boolean {
  if (!contentType) return true; // Some servers omit Content-Type on HTML
  const lower = contentType.toLowerCase();
  return (
    lower.includes('text/html') ||
    lower.includes('application/xhtml+xml') ||
    lower.includes('text/plain')
  );
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      {
        success: false,
        code: 'RATE_LIMITED',
        error: 'Too many requests. Please wait a minute before analysing another URL.',
      },
      { status: 429, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, code: 'INVALID_JSON', error: 'Invalid JSON request body.' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const mode = body.mode === 'text' ? 'text' : 'url';
  const contentScope: ContentScope = body.contentScope === 'full' ? 'full' : 'main';
  const stopWordsExcluded = body.stopWordsExcluded !== false;
  const minFrequency =
    typeof body.minFrequency === 'number' && Number.isFinite(body.minFrequency) && body.minFrequency >= 1
      ? Math.min(100, Math.floor(body.minFrequency))
      : 2;
  const targetKeywords =
    typeof body.targetKeywords === 'string' || Array.isArray(body.targetKeywords)
      ? (body.targetKeywords as string | string[])
      : '';
  const useJsRendering = Boolean(body.useJsRendering);

  // Mode B: Paste Text
  if (mode === 'text') {
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json(
        { success: false, code: 'EMPTY_INPUT', error: 'Please enter or paste content to analyse.' },
        { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }
    if (text.length > MAX_PASTED_TEXT_CHARS) {
      return NextResponse.json(
        {
          success: false,
          code: 'INPUT_LIMIT_EXCEEDED',
          error: `Pasted content exceeds the maximum limit of ${MAX_PASTED_TEXT_CHARS.toLocaleString()} characters.`,
        },
        { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const result = analyzePlainText({
      text,
      targetKeywordsInput: targetKeywords,
      stopWordsExcluded,
      minFrequency,
    });

    if (result.totalWords === 0) {
      return NextResponse.json(
        {
          success: false,
          code: 'EMPTY_CONTENT',
          error: 'No readable words were found in the pasted text.',
        },
        { status: 422, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  // Mode A: Analyse URL
  const rawUrl = typeof body.url === 'string' ? body.url : '';
  if (!rawUrl.trim()) {
    return NextResponse.json(
      { success: false, code: 'EMPTY_INPUT', error: 'Please enter a webpage URL to analyse.' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
  if (rawUrl.trim().length > MAX_URL_LENGTH) {
    return NextResponse.json(
      { success: false, code: 'INVALID_URL', error: 'URL exceeds maximum allowed length (2048 characters).' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const normalizedUrl = normalizeInputUrl(rawUrl);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    return NextResponse.json(
      { success: false, code: 'INVALID_URL', error: 'Please enter a valid HTTP or HTTPS webpage URL.' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return NextResponse.json(
      {
        success: false,
        code: 'UNSUPPORTED_PROTOCOL',
        error: `Unsupported protocol "${parsedUrl.protocol}". Only HTTP and HTTPS webpages are supported.`,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  try {
    const fetchResult = await safeFetch(normalizedUrl, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      maxBytes: MAX_HTML_BYTES,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 IndianMarketersBot/1.0',
    });

    if (fetchResult.statusCode >= 400) {
      const statusMessages: Record<number, string> = {
        403: 'Access denied (HTTP 403 Forbidden). The website blocked automated fetching. You can copy the page text and use Paste Text mode.',
        404: 'Webpage not found (HTTP 404). Please verify the URL is correct and publicly accessible.',
        429: 'The target server returned HTTP 429 (Too Many Requests). Please wait and try again later.',
      };
      const errorMsg =
        statusMessages[fetchResult.statusCode] ||
        `Target server returned HTTP ${fetchResult.statusCode}${fetchResult.statusText ? ` (${fetchResult.statusText})` : ''}.`;

      return NextResponse.json(
        { success: false, code: `HTTP_${fetchResult.statusCode}`, error: errorMsg },
        { status: 422, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    if (!isSupportedHtmlContentType(fetchResult.contentType)) {
      return NextResponse.json(
        {
          success: false,
          code: 'UNSUPPORTED_CONTENT',
          error: `Unsupported content type (${fetchResult.contentType}). Only HTML webpages can be analysed.`,
        },
        { status: 422, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const htmlToAnalyze = fetchResult.body;
    let finalUrl = fetchResult.finalUrl;
    let extraction = extractHtmlForKeywordDensity(htmlToAnalyze, finalUrl, contentScope);
    let extractionMethod: ExtractionMethod = extraction.extractionMethod;
    const warnings = [...extraction.warnings];

    if (fetchResult.isTruncated) {
      warnings.push('The webpage HTML exceeded the 5 MB download limit and was truncated. Results represent partial content.');
    }

    const preliminaryWords = extraction.extractedText.split(/\s+/).filter(Boolean).length;
    const jsAvailable = isBrowserRenderAvailable();

    // Optional JS-rendered fallback when requested or when SPA shell has minimal static HTML
    if ((useJsRendering || (extraction.isLikelySpa && preliminaryWords < 50)) && jsAvailable) {
      try {
        const provider = getBrowserRenderProvider();
        const renderResult = await provider.render({
          url: finalUrl,
          userAgent: getFetchRenderUserAgent('chrome-desktop'),
          respectRobots: false,
          postLoadWaitMs: 1500,
          timeoutMs: FETCH_TIMEOUT_MS,
          acceptLanguage: 'en-US,en;q=0.9',
          captureScreenshot: false,
        });

        if (renderResult.renderedHtml) {
          const renderedExtraction = extractHtmlForKeywordDensity(
            renderResult.renderedHtml,
            renderResult.finalUrl || finalUrl,
            contentScope
          );
          const renderedWords = renderedExtraction.extractedText.split(/\s+/).filter(Boolean).length;
          if (renderedWords > preliminaryWords || useJsRendering) {
            extraction = renderedExtraction;
            extractionMethod = 'js-rendered';
            finalUrl = renderResult.finalUrl || finalUrl;
            warnings.push(...renderedExtraction.warnings);
          }
        }
      } catch {
        if (preliminaryWords < 50) {
          warnings.push(
            'Limited readable content was found in the server-delivered HTML. This webpage may require JavaScript rendering. Try the rendered analysis option if available, or paste the webpage content manually.'
          );
        }
      }
    } else if (preliminaryWords < 50 && (extraction.isLikelySpa || preliminaryWords > 0)) {
      warnings.push(
        'Limited readable content was found in the server-delivered HTML. This webpage may require JavaScript rendering. Try the rendered analysis option if available, or paste the webpage content manually.'
      );
    }

    const analysisResult = analyzeSegments({
      mode: 'url',
      segments: extraction.segments,
      extractedText: extraction.extractedText,
      targetKeywordsInput: targetKeywords,
      stopWordsExcluded,
      minFrequency,
      contentScope,
      extractionMethod,
      requestedUrl: fetchResult.requestedUrl,
      finalUrl,
      httpStatus: fetchResult.statusCode,
      metadataSignals: extraction.metadataSignals,
      warnings: Array.from(new Set(warnings)),
      isTruncated: extraction.isTruncated || fetchResult.isTruncated,
      jsRenderAvailable: jsAvailable,
    });

    if (analysisResult.totalWords === 0) {
      return NextResponse.json(
        {
          success: false,
          code: 'EMPTY_WEBPAGE_CONTENT',
          error:
            'No readable text content was found on this webpage. If the site relies heavily on client-side JavaScript, paste the webpage content manually using Paste Text mode.',
        },
        { status: 422, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    return NextResponse.json(analysisResult, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err || '');
    const lower = rawMsg.toLowerCase();
    if (
      lower.includes('blocked or internal hostname') ||
      lower.includes('private or reserved') ||
      lower.includes('resolves to blocked') ||
      lower.includes('ssrf')
    ) {
      return NextResponse.json(
        {
          success: false,
          code: 'BLOCKED_DESTINATION',
          error: 'Access to internal, loopback, or private network addresses is not permitted.',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }
    const sanitized = classifyAndSanitizeError(err, 'Failed to fetch and analyse the webpage.');
    return NextResponse.json(
      {
        success: false,
        code: sanitized.code,
        error: sanitized.message,
      },
      { status: sanitized.status, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
