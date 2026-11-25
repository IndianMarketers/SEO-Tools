import { STOP_WORDS } from './stopWords';
import { tokenizeSegment, parsePlainTextToSegments } from './tokenizer';
import type {
  AnalysisMode,
  AutoKeywordResult,
  AutoKeywordsByLength,
  ContentScope,
  ContentSegment,
  ExtractionMethod,
  KeywordDensityAnalysisResult,
  PageMetadataSignals,
  PlacementResult,
  TargetKeywordResult,
} from './types';
import { analyzeKeywordPlacement } from './placementAnalyzer';

export const MAX_TARGET_KEYWORDS = 100;
export const MAX_AUTO_KEYWORDS_PER_TAB = 500;

export interface ParsedTargetKeywordsResult {
  keywords: string[];
  truncatedCount: number;
}

/**
 * Parses target keywords from newline- and/or comma-separated input.
 * Preserves commas inside double-quoted CSV-style entries.
 * Deduplicates case-insensitively while preserving the first valid entered form for display.
 */
export function parseTargetKeywords(
  input: string | string[],
  maxKeywords: number = MAX_TARGET_KEYWORDS
): ParsedTargetKeywordsResult {
  const rawEntries: string[] = [];

  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        rawEntries.push(...splitKeywordLine(item));
      }
    }
  } else if (typeof input === 'string') {
    const lines = input.split(/\r?\n/);
    for (const line of lines) {
      rawEntries.push(...splitKeywordLine(line));
    }
  }

  const seen = new Set<string>();
  const keywords: string[] = [];
  let truncatedCount = 0;

  for (const raw of rawEntries) {
    const cleaned = raw.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;

    // Must contain at least one valid word/alphanumeric token
    const tokens = tokenizeSegment(cleaned);
    if (tokens.length === 0) continue;

    const dedupeKey = tokens.join(' ');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (keywords.length < maxKeywords) {
      keywords.push(cleaned);
    } else {
      truncatedCount++;
    }
  }

  return { keywords, truncatedCount };
}

function splitKeywordLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Counts exact consecutive token matches of `kwTokens` within `segTokens`.
 * Counts all valid overlapping starting positions (e.g. "land land land" for "land land" = 2).
 */
export function countPhraseOccurrencesInTokens(
  segTokens: string[],
  kwTokens: string[]
): number[] {
  const positions: number[] = [];
  const kLen = kwTokens.length;
  if (kLen === 0 || segTokens.length < kLen) return positions;

  const limit = segTokens.length - kLen;
  for (let i = 0; i <= limit; i++) {
    let match = true;
    for (let j = 0; j < kLen; j++) {
      if (segTokens[i + j] !== kwTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      positions.push(i);
    }
  }
  return positions;
}

export interface AnalyzeSegmentsParams {
  mode: AnalysisMode;
  segments: ContentSegment[];
  extractedText: string;
  targetKeywordsInput?: string | string[];
  stopWordsExcluded?: boolean;
  minFrequency?: number;
  contentScope?: ContentScope;
  extractionMethod?: ExtractionMethod;
  requestedUrl?: string;
  finalUrl?: string;
  httpStatus?: number;
  metadataSignals?: PageMetadataSignals;
  warnings?: string[];
  isTruncated?: boolean;
  jsRenderAvailable?: boolean;
}

/**
 * Core deterministic keyword density & distribution analysis engine.
 * Works identically on server and browser.
 */
export function analyzeSegments(params: AnalyzeSegmentsParams): KeywordDensityAnalysisResult {
  const startTime = Date.now();
  const stopWordsExcluded = params.stopWordsExcluded ?? true;
  const minFrequency = Math.max(1, Math.floor(params.minFrequency ?? 2));
  const contentScope: ContentScope = params.contentScope ?? 'main';
  const extractionMethod: ExtractionMethod = params.extractionMethod ?? 'manual-text';
  const warnings = [...(params.warnings || [])];

  // Tokenize all segments once
  const segmentTokenLists: string[][] = [];
  const segmentStartGlobalIdx: number[] = [];
  const uniqueWordSet = new Set<string>();
  let totalWords = 0;

  for (const seg of params.segments) {
    const tokens = tokenizeSegment(seg.text);
    segmentTokenLists.push(tokens);
    segmentStartGlobalIdx.push(totalWords);
    totalWords += tokens.length;
    for (const t of tokens) {
      uniqueWordSet.add(t);
    }
  }

  const uniqueWords = uniqueWordSet.size;
  const totalCharacters = params.extractedText.length;

  // 1. Custom Target Keyword Analysis
  const { keywords: parsedTargets, truncatedCount } = parseTargetKeywords(
    params.targetKeywordsInput || ''
  );
  if (truncatedCount > 0) {
    warnings.push(
      `Only the first ${MAX_TARGET_KEYWORDS} unique target keywords were analysed (${truncatedCount} additional keyword(s) exceeded the limit).`
    );
  }

  const customKeywords: TargetKeywordResult[] = parsedTargets.map((displayKw) => {
    const kwTokens = tokenizeSegment(displayKw);
    const wordCount = kwTokens.length;
    let frequency = 0;
    const distribution: [number, number, number, number] = [0, 0, 0, 0];

    for (let sIdx = 0; sIdx < segmentTokenLists.length; sIdx++) {
      const segTokens = segmentTokenLists[sIdx];
      const matches = countPhraseOccurrencesInTokens(segTokens, kwTokens);
      if (matches.length > 0) {
        frequency += matches.length;
        const baseOffset = segmentStartGlobalIdx[sIdx];
        for (const localPos of matches) {
          const globalPos = baseOffset + localPos;
          const quarter = totalWords > 0
            ? Math.min(3, Math.floor((globalPos / totalWords) * 4))
            : 0;
          distribution[quarter]++;
        }
      }
    }

    const density = totalWords > 0 ? (frequency / totalWords) * 100 : 0;
    return {
      keyword: displayKw,
      normalized: kwTokens.join(' '),
      wordCount,
      frequency,
      density,
      status: frequency > 0 ? 'Found' : 'Not Found',
      distribution,
    };
  });

  // 2. Automatic Keyword Discovery (1-word to 4-word n-grams in a single bounded pass)
  const ngramMaps: Record<1 | 2 | 3 | 4, Map<string, number>> = {
    1: new Map(),
    2: new Map(),
    3: new Map(),
    4: new Map(),
  };

  for (const tokens of segmentTokenLists) {
    const len = tokens.length;
    for (let i = 0; i < len; i++) {
      // 1-word
      const t1 = tokens[i];
      if (!stopWordsExcluded || !STOP_WORDS.has(t1)) {
        ngramMaps[1].set(t1, (ngramMaps[1].get(t1) || 0) + 1);
      }

      // 2-word
      if (i + 1 < len) {
        const t2 = tokens[i + 1];
        if (!stopWordsExcluded || !STOP_WORDS.has(t1) || !STOP_WORDS.has(t2)) {
          const phrase = `${t1} ${t2}`;
          ngramMaps[2].set(phrase, (ngramMaps[2].get(phrase) || 0) + 1);
        }
      }

      // 3-word
      if (i + 2 < len) {
        const t2 = tokens[i + 1];
        const t3 = tokens[i + 2];
        if (!stopWordsExcluded || !STOP_WORDS.has(t1) || !STOP_WORDS.has(t2) || !STOP_WORDS.has(t3)) {
          const phrase = `${t1} ${t2} ${t3}`;
          ngramMaps[3].set(phrase, (ngramMaps[3].get(phrase) || 0) + 1);
        }
      }

      // 4-word
      if (i + 3 < len) {
        const t2 = tokens[i + 1];
        const t3 = tokens[i + 2];
        const t4 = tokens[i + 3];
        if (!stopWordsExcluded || !STOP_WORDS.has(t1) || !STOP_WORDS.has(t2) || !STOP_WORDS.has(t3) || !STOP_WORDS.has(t4)) {
          const phrase = `${t1} ${t2} ${t3} ${t4}`;
          ngramMaps[4].set(phrase, (ngramMaps[4].get(phrase) || 0) + 1);
        }
      }
    }
  }

  let totalAutoKeywordsEligible = 0;
  const autoKeywords: AutoKeywordsByLength = { 1: [], 2: [], 3: [], 4: [] };

  ([1, 2, 3, 4] as const).forEach((n) => {
    const eligible: AutoKeywordResult[] = [];
    for (const [phrase, freq] of ngramMaps[n].entries()) {
      if (freq >= minFrequency) {
        eligible.push({
          keyword: phrase,
          phraseLength: n,
          frequency: freq,
          density: totalWords > 0 ? (freq / totalWords) * 100 : 0,
        });
      }
    }

    totalAutoKeywordsEligible += eligible.length;

    eligible.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.keyword.localeCompare(b.keyword);
    });

    autoKeywords[n] = eligible.slice(0, MAX_AUTO_KEYWORDS_PER_TAB);
  });

  // 3. Placement Analysis (for URL mode when metadataSignals are available)
  let placement: PlacementResult[] | undefined;
  if (params.mode === 'url' && params.metadataSignals && customKeywords.length > 0) {
    placement = analyzeKeywordPlacement(
      customKeywords.map((c) => ({ keyword: c.keyword, bodyFrequency: c.frequency })),
      params.metadataSignals
    );
  }

  return {
    success: true,
    mode: params.mode,
    requestedUrl: params.requestedUrl,
    finalUrl: params.finalUrl,
    httpStatus: params.httpStatus,
    extractionMethod,
    contentScope,
    stopWordsExcluded,
    minFrequency,
    extractedText: params.extractedText,
    segments: params.segments,
    totalWords,
    uniqueWords,
    totalCharacters,
    totalAutoKeywordsEligible,
    customKeywords,
    autoKeywords,
    placement,
    metadataSignals: params.metadataSignals,
    processingDurationMs: Date.now() - startTime,
    warnings,
    isTruncated: params.isTruncated,
    jsRenderAvailable: params.jsRenderAvailable,
  };
}

/**
 * Convenience function to run full analysis on manually pasted plain text.
 */
export function analyzePlainText(params: {
  text: string;
  targetKeywordsInput?: string | string[];
  stopWordsExcluded?: boolean;
  minFrequency?: number;
}): KeywordDensityAnalysisResult {
  const { extractedText, segments } = parsePlainTextToSegments(params.text);
  return analyzeSegments({
    mode: 'text',
    segments,
    extractedText,
    targetKeywordsInput: params.targetKeywordsInput,
    stopWordsExcluded: params.stopWordsExcluded,
    minFrequency: params.minFrequency,
    contentScope: 'full',
    extractionMethod: 'manual-text',
  });
}
