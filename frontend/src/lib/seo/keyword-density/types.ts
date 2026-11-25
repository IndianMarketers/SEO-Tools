export type AnalysisMode = 'url' | 'text';
export type ContentScope = 'main' | 'full';
export type ExtractionMethod =
  | 'server-html'
  | 'js-rendered'
  | 'cleaned-body-fallback'
  | 'manual-text';

export interface ContentSegment {
  text: string;
  heading: string | null;
}

export interface TargetKeywordResult {
  keyword: string;
  normalized: string;
  wordCount: number;
  frequency: number;
  density: number;
  status: 'Found' | 'Not Found';
  distribution: [number, number, number, number];
}

export interface AutoKeywordResult {
  keyword: string;
  phraseLength: 1 | 2 | 3 | 4;
  frequency: number;
  density: number;
}

export interface AutoKeywordsByLength {
  1: AutoKeywordResult[];
  2: AutoKeywordResult[];
  3: AutoKeywordResult[];
  4: AutoKeywordResult[];
}

export interface PageMetadataSignals {
  hasTitle: boolean;
  title: string | null;
  hasMetaDescription: boolean;
  metaDescription: string | null;
  hasH1: boolean;
  h1Texts: string[];
  hasH2: boolean;
  h2Texts: string[];
  hasH3: boolean;
  h3Texts: string[];
  hasH4To6: boolean;
  h4To6Texts: string[];
  hasAnchors: boolean;
  anchorTexts: string[];
  hasAltText: boolean;
  altTexts: string[];
  urlPathText: string;
}

export interface PlacementResult {
  keyword: string;
  title: number | null;
  metaDescription: number | null;
  h1: number | null;
  h2: number | null;
  h3: number | null;
  h4To6: number | null;
  body: number;
  anchors: number | null;
  altText: number | null;
  urlPath: number;
}

export interface KeywordContextMatch {
  segmentIndex: number;
  sectionHeading: string | null;
  text: string;
  matchCount: number;
}

export interface KeywordDensityAnalysisResult {
  success: boolean;
  mode: AnalysisMode;
  requestedUrl?: string;
  finalUrl?: string;
  httpStatus?: number;
  extractionMethod: ExtractionMethod;
  contentScope: ContentScope;
  stopWordsExcluded: boolean;
  minFrequency: number;
  extractedText: string;
  segments: ContentSegment[];
  totalWords: number;
  uniqueWords: number;
  totalCharacters: number;
  totalAutoKeywordsEligible: number;
  customKeywords: TargetKeywordResult[];
  autoKeywords: AutoKeywordsByLength;
  placement?: PlacementResult[];
  metadataSignals?: PageMetadataSignals;
  processingDurationMs: number;
  warnings: string[];
  isTruncated?: boolean;
  jsRenderAvailable?: boolean;
}
