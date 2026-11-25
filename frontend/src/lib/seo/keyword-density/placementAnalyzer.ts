import { tokenizeSegment } from './tokenizer';
import { countPhraseOccurrencesInTokens } from './analyzer';
import type { PageMetadataSignals, PlacementResult } from './types';

function countInStringList(texts: string[], kwTokens: string[]): number {
  let total = 0;
  for (const t of texts) {
    const tokens = tokenizeSegment(t);
    total += countPhraseOccurrencesInTokens(tokens, kwTokens).length;
  }
  return total;
}

export function analyzeKeywordPlacement(
  keywords: { keyword: string; bodyFrequency: number }[],
  signals: PageMetadataSignals
): PlacementResult[] {
  return keywords.map(({ keyword, bodyFrequency }) => {
    const kwTokens = tokenizeSegment(keyword);

    return {
      keyword,
      title: signals.hasTitle && signals.title
        ? countPhraseOccurrencesInTokens(tokenizeSegment(signals.title), kwTokens).length
        : null,
      metaDescription: signals.hasMetaDescription && signals.metaDescription
        ? countPhraseOccurrencesInTokens(tokenizeSegment(signals.metaDescription), kwTokens).length
        : null,
      h1: signals.hasH1 ? countInStringList(signals.h1Texts, kwTokens) : null,
      h2: signals.hasH2 ? countInStringList(signals.h2Texts, kwTokens) : null,
      h3: signals.hasH3 ? countInStringList(signals.h3Texts, kwTokens) : null,
      h4To6: signals.hasH4To6 ? countInStringList(signals.h4To6Texts, kwTokens) : null,
      body: bodyFrequency,
      anchors: signals.hasAnchors ? countInStringList(signals.anchorTexts, kwTokens) : null,
      altText: signals.hasAltText ? countInStringList(signals.altTexts, kwTokens) : null,
      urlPath: countPhraseOccurrencesInTokens(tokenizeSegment(signals.urlPathText), kwTokens).length,
    };
  });
}
