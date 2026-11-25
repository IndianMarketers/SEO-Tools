import type { ContentSegment } from './types';

/**
 * Normalizes text for deterministic tokenization:
 * - Unicode NFC normalization
 * - Converts non-breaking spaces and special spaces to standard spaces
 * - Normalizes curly apostrophes and typographic dashes
 */
export function normalizeTextForTokenization(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFC')
    .replace(/[\u00A0\u2007\u202F\u200B\uFEFF]/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, ' ');
}

const TOKEN_REGEX = /[\p{L}\p{N}]+(?:['\-][\p{L}\p{N}]+)*/gu;

/**
 * Tokenizes a single contiguous text segment into normalized lowercase tokens.
 * Preserves meaningful internal hyphens (co-working) and apostrophes (buyer's),
 * supports Unicode letters and alphanumeric terms, and excludes punctuation-only tokens.
 */
export function tokenizeSegment(text: string): string[] {
  const normalized = normalizeTextForTokenization(text).toLowerCase();
  const matches = normalized.match(TOKEN_REGEX);
  return matches ? matches : [];
}

/**
 * Splits a block of text into sentence-level contiguous segments so that
 * multi-word phrases never cross sentence boundaries.
 */
export function splitBlockIntoSentences(blockText: string): string[] {
  const cleaned = blockText.replace(/[ \t\r\n]+/g, ' ').trim();
  if (!cleaned) return [];

  // Split on sentence-ending punctuation (. ! ? or Devanagari danda ।) followed by whitespace
  // Avoid splitting common abbreviations or decimal numbers like 3.5
  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '।') {
      const next = cleaned[i + 1];
      const prev = cleaned[i - 1];
      // Decimal number check: digit before and digit after
      if (ch === '.' && prev && /\d/.test(prev) && next && /\d/.test(next)) {
        continue;
      }
      // End of sentence if followed by whitespace (and optional closing quote/paren)
      let endIdx = i + 1;
      while (endIdx < cleaned.length && (cleaned[endIdx] === '"' || cleaned[endIdx] === "'" || cleaned[endIdx] === ')' || cleaned[endIdx] === ']')) {
        endIdx++;
      }
      if (endIdx < cleaned.length && /\s/.test(cleaned[endIdx])) {
        const part = cleaned.slice(start, endIdx).trim();
        if (part) sentences.push(part);
        start = endIdx + 1;
        i = endIdx;
      }
    }
  }

  const tail = cleaned.slice(start).trim();
  if (tail) sentences.push(tail);

  return sentences;
}

/**
 * Converts raw pasted plain text into paragraph- and sentence-bounded ContentSegments.
 * Preserves paragraph boundaries and avoids creating artificial phrase matches across lines/paragraphs.
 */
export function parsePlainTextToSegments(text: string): {
  extractedText: string;
  segments: ContentSegment[];
} {
  const normalized = normalizeTextForTokenization(text);
  const lines = normalized.split(/\r?\n/);
  const blocks: string[] = [];
  const segments: ContentSegment[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.replace(/[ \t]+/g, ' ').trim();
    if (!trimmed) continue;
    blocks.push(trimmed);
    const sentences = splitBlockIntoSentences(trimmed);
    for (const s of sentences) {
      segments.push({ text: s, heading: null });
    }
  }

  return {
    extractedText: blocks.join('\n\n'),
    segments,
  };
}
