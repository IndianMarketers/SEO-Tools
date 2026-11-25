import { normalizeTextForTokenization, tokenizeSegment } from './tokenizer';
import { countPhraseOccurrencesInTokens } from './analyzer';
import type { ContentSegment, KeywordContextMatch } from './types';

export interface HighlightPart {
  text: string;
  isMatch: boolean;
}

/**
 * Finds all content segments containing exact normalized occurrences of `keyword`.
 */
export function findKeywordContextMatches(
  segments: ContentSegment[],
  keyword: string
): KeywordContextMatch[] {
  const kwTokens = tokenizeSegment(keyword);
  if (kwTokens.length === 0) return [];

  const matches: KeywordContextMatch[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segTokens = tokenizeSegment(seg.text);
    const positions = countPhraseOccurrencesInTokens(segTokens, kwTokens);
    if (positions.length > 0) {
      matches.push({
        segmentIndex: i,
        sectionHeading: seg.heading,
        text: seg.text,
        matchCount: positions.length,
      });
    }
  }

  return matches;
}

/**
 * Splits a segment's original text into safe React-renderable text/highlight parts.
 * Preserves original capitalization and highlights only exact token-boundary matches.
 */
export function buildHighlightedParts(originalText: string, keyword: string): HighlightPart[] {
  const kwTokens = tokenizeSegment(keyword);
  if (kwTokens.length === 0 || !originalText) {
    return [{ text: originalText, isMatch: false }];
  }

  const normalized = normalizeTextForTokenization(originalText);
  // Note: NFC normalization can change string length in rare combining-char cases,
  // so we run regex on the same string we slice from.
  const tokenRegex = /[\p{L}\p{N}]+(?:['\-][\p{L}\p{N}]+)*/gu;
  const tokenSpans: { token: string; start: number; end: number }[] = [];

  for (const m of normalized.matchAll(tokenRegex)) {
    if (m.index !== undefined) {
      tokenSpans.push({
        token: m[0].toLowerCase(),
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }

  if (tokenSpans.length < kwTokens.length) {
    return [{ text: normalized, isMatch: false }];
  }

  const segTokens = tokenSpans.map((s) => s.token);
  const matchPositions = countPhraseOccurrencesInTokens(segTokens, kwTokens);
  if (matchPositions.length === 0) {
    return [{ text: normalized, isMatch: false }];
  }

  // Merge overlapping match character ranges
  const ranges: [number, number][] = matchPositions.map((pos) => [
    tokenSpans[pos].start,
    tokenSpans[pos + kwTokens.length - 1].end,
  ]);

  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    if (merged.length > 0 && start <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], end);
    } else {
      merged.push([start, end]);
    }
  }

  const parts: HighlightPart[] = [];
  let cursor = 0;

  for (const [start, end] of merged) {
    if (start > cursor) {
      parts.push({ text: normalized.slice(cursor, start), isMatch: false });
    }
    parts.push({ text: normalized.slice(start, end), isMatch: true });
    cursor = end;
  }

  if (cursor < normalized.length) {
    parts.push({ text: normalized.slice(cursor), isMatch: false });
  }

  return parts;
}
