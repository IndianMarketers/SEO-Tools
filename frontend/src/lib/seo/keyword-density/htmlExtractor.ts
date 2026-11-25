import * as cheerio from 'cheerio';
import { normalizeTextForTokenization, splitBlockIntoSentences } from './tokenizer';
import type { ContentScope, ContentSegment, ExtractionMethod, PageMetadataSignals } from './types';

export const MAX_EXTRACTED_TEXT_CHARS = 300_000;

export interface HtmlExtractionOutput {
  extractedText: string;
  segments: ContentSegment[];
  metadataSignals: PageMetadataSignals;
  extractionMethod: ExtractionMethod;
  isTruncated: boolean;
  isLikelySpa: boolean;
  warnings: string[];
}

function buildUrlPathText(finalUrl: string): string {
  try {
    const u = new URL(finalUrl);
    const decoded = decodeURIComponent(u.pathname || '');
    return decoded.replace(/[\/\-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * Extracts readable content, block/sentence segments, and metadata signals from HTML.
 * - Uses Cheerio DOM parser (never regex-only HTML parsing).
 * - Never counts nested DOM text nodes twice.
 * - Never substitutes Open Graph metadata for standard title/meta description.
 * - Never counts image filenames as alt text.
 */
export function extractHtmlForKeywordDensity(
  html: string,
  finalUrl: string,
  contentScope: ContentScope = 'main'
): HtmlExtractionOutput {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  // 1. Extract head metadata BEFORE pruning (strictly standard title & meta description)
  const titleEl = $('title').first();
  const hasTitle = titleEl.length > 0;
  const title = hasTitle ? titleEl.text().replace(/\s+/g, ' ').trim() : null;

  const metaDescEl = $('meta[name="description" i]').first();
  const hasMetaDescription = metaDescEl.length > 0 && metaDescEl.attr('content') !== undefined;
  const metaDescription = hasMetaDescription ? (metaDescEl.attr('content') || '').replace(/\s+/g, ' ').trim() : null;

  // 2. Remove always-excluded technical/hidden elements
  $(
    'script, style, noscript, template, svg, iframe, [aria-hidden="true"], [hidden]'
  ).remove();

  // Remove inline display:none elements
  $('[style]').each((_, el) => {
    const style = ($(el).attr('style') || '').toLowerCase();
    if (/display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style)) {
      $(el).remove();
    }
  });

  // 3. Determine scope container
  let $scope: ReturnType<typeof $> = $('body');
  let extractionMethod: ExtractionMethod = 'server-html';

  if (contentScope === 'main') {
    // Remove boilerplate elements
    $(
      'nav, footer, header, aside, form, ' +
      '.cookie-banner, #cookie, #cookie-banner, .gdpr, .cookie-consent, ' +
      '[role="navigation"], [role="banner"], [role="contentinfo"], ' +
      '.ad, .ads, .advertisement, .sidebar, .social-share, .share-buttons, .chat-widget'
    ).remove();

    // Hierarchy: 1. main / article / [role="main"] -> 2. content containers -> 3. cleaned body fallback
    const primarySelectors = ['main', '[role="main"]', 'article'];
    const secondarySelectors = [
      '.content',
      '.post-content',
      '.entry-content',
      '#content',
      '.article-body',
      '.article-content',
    ];

    let bestEl: ReturnType<typeof $> | null = null;
    let bestLen = 0;

    for (const sel of primarySelectors) {
      $(sel).each((_, el) => {
        const txt = $(el).text().replace(/\s+/g, ' ').trim();
        if (txt.length > bestLen && txt.length > 100) {
          bestLen = txt.length;
          bestEl = $(el);
        }
      });
    }

    if (!bestEl) {
      for (const sel of secondarySelectors) {
        $(sel).each((_, el) => {
          const txt = $(el).text().replace(/\s+/g, ' ').trim();
          if (txt.length > bestLen && txt.length > 100) {
            bestLen = txt.length;
            bestEl = $(el);
          }
        });
      }
    }

    if (bestEl) {
      $scope = bestEl;
    } else {
      $scope = $('body');
      extractionMethod = 'cleaned-body-fallback';
      warnings.push('No dedicated main content container (<main> or <article>) was detected; used cleaned body content fallback.');
    }
  }

  // 4. Extract structural signals within selected scope
  const h1Texts: string[] = [];
  const h2Texts: string[] = [];
  const h3Texts: string[] = [];
  const h4To6Texts: string[] = [];

  $scope.find('h1').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) h1Texts.push(t);
  });
  $scope.find('h2').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) h2Texts.push(t);
  });
  $scope.find('h3').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) h3Texts.push(t);
  });
  $scope.find('h4, h5, h6').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) h4To6Texts.push(t);
  });

  const anchorTexts: string[] = [];
  $scope.find('a').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) anchorTexts.push(t);
  });

  const altTexts: string[] = [];
  $scope.find('img').each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt !== undefined) {
      const t = alt.replace(/\s+/g, ' ').trim();
      if (t) altTexts.push(t);
    }
  });

  const metadataSignals: PageMetadataSignals = {
    hasTitle,
    title,
    hasMetaDescription,
    metaDescription,
    hasH1: $scope.find('h1').length > 0,
    h1Texts,
    hasH2: $scope.find('h2').length > 0,
    h2Texts,
    hasH3: $scope.find('h3').length > 0,
    h3Texts,
    hasH4To6: $scope.find('h4, h5, h6').length > 0,
    h4To6Texts,
    hasAnchors: $scope.find('a').length > 0,
    anchorTexts,
    hasAltText: $scope.find('img[alt]').length > 0,
    altTexts,
    urlPathText: buildUrlPathText(finalUrl),
  };

  // 5. Extract readable text with preserved block boundaries (no double-counting nested nodes)
  $scope.find('br').replaceWith('\n');
  const BLOCK_TAGS = 'p, h1, h2, h3, h4, h5, h6, li, tr, td, th, blockquote, div, section, article, header, footer, dt, dd, figcaption';
  $scope.find(BLOCK_TAGS).each((_, el) => {
    const tag = ((el as { tagName?: string }).tagName || '').toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      $(el).prepend('\n@@HEADING@@');
    }
    $(el).prepend('\n').append('\n');
  });

  let rawText = $scope.text();
  rawText = normalizeTextForTokenization(rawText);

  const rawLines = rawText.split(/\r?\n/);
  const blocks: { text: string; isHeading: boolean }[] = [];

  for (const line of rawLines) {
    const isHeading = line.includes('@@HEADING@@');
    const cleanLine = line.replace(/@@HEADING@@/g, '').replace(/[ \t]+/g, ' ').trim();
    if (!cleanLine) continue;
    blocks.push({ text: cleanLine, isHeading });
  }

  let currentHeading: string | null = null;
  const segments: ContentSegment[] = [];
  const extractedBlocks: string[] = [];
  let totalChars = 0;
  let isTruncated = false;

  for (const blk of blocks) {
    if (totalChars + blk.text.length > MAX_EXTRACTED_TEXT_CHARS) {
      const remaining = MAX_EXTRACTED_TEXT_CHARS - totalChars;
      if (remaining > 0) {
        const sliced = blk.text.slice(0, remaining).trim();
        if (sliced) {
          extractedBlocks.push(sliced);
          for (const s of splitBlockIntoSentences(sliced)) {
            segments.push({ text: s, heading: currentHeading });
          }
        }
      }
      isTruncated = true;
      break;
    }

    if (blk.isHeading) {
      currentHeading = blk.text.slice(0, 140);
    }

    extractedBlocks.push(blk.text);
    totalChars += blk.text.length + 2;

    for (const s of splitBlockIntoSentences(blk.text)) {
      segments.push({ text: s, heading: currentHeading });
    }
  }

  if (isTruncated) {
    warnings.push(
      `Extracted content exceeded ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString()} characters and was truncated. Results represent partial content.`
    );
  }

  const extractedText = extractedBlocks.join('\n\n');

  // 6. Check for SPA / JS-rendered indicators
  const spaIndicators = [
    'react-root',
    'data-reactroot',
    'id="root"',
    'id="__next"',
    'id="__nuxt"',
    'ng-version',
    '<app-root>',
    'window.__INITIAL_STATE__',
  ];
  const isLikelySpa = spaIndicators.some((ind) => html.includes(ind));

  return {
    extractedText,
    segments,
    metadataSignals,
    extractionMethod,
    isTruncated,
    isLikelySpa,
    warnings,
  };
}
