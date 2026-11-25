import type {
  AutoKeywordResult,
  KeywordDensityAnalysisResult,
  PlacementResult,
  TargetKeywordResult,
} from './types';

/**
 * Escapes a single CSV cell per RFC 4180 and neutralizes CSV formula injection (=, +, -, @, \t, \r).
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = String(value);

  // Prevent CSV formula injection in Excel / Google Sheets
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  // UTF-8 BOM for Excel compatibility
  return '\uFEFF' + [headerLine, ...dataLines].join('\r\n');
}

function getSourceLabel(result: KeywordDensityAnalysisResult): string {
  if (result.mode === 'url') {
    return result.finalUrl || result.requestedUrl || 'URL';
  }
  return 'Manual Text Input';
}

function getScopeLabel(result: KeywordDensityAnalysisResult): string {
  if (result.mode === 'text') return 'Pasted Content';
  return result.contentScope === 'main' ? 'Main Content Only' : 'Full Visible Page Content';
}

export function generateTargetKeywordsCsv(
  result: KeywordDensityAnalysisResult,
  customKeywords: TargetKeywordResult[]
): string {
  const source = getSourceLabel(result);
  const scope = getScopeLabel(result);

  const headers = [
    'Source URL',
    'Content Scope',
    'Total Analysed Words',
    'Target Keyword',
    'Keyword Word Count',
    'Frequency',
    'Density Percentage',
    'Status',
  ];

  const rows = customKeywords.map((kw) => [
    source,
    scope,
    result.totalWords,
    kw.keyword,
    kw.wordCount,
    kw.frequency,
    `${kw.density.toFixed(2)}%`,
    kw.status,
  ]);

  return buildCsv(headers, rows);
}

export function generateAutoKeywordsCsv(
  result: KeywordDensityAnalysisResult,
  phraseLength: 1 | 2 | 3 | 4 | 'all'
): string {
  const source = getSourceLabel(result);
  const scope = getScopeLabel(result);

  const headers = [
    'Source URL',
    'Content Scope',
    'Phrase Length',
    'Keyword',
    'Frequency',
    'Density Percentage',
  ];

  const items: AutoKeywordResult[] =
    phraseLength === 'all'
      ? [
          ...result.autoKeywords[1],
          ...result.autoKeywords[2],
          ...result.autoKeywords[3],
          ...result.autoKeywords[4],
        ]
      : result.autoKeywords[phraseLength];

  const rows = items.map((item) => [
    source,
    scope,
    `${item.phraseLength} Word${item.phraseLength > 1 ? 's' : ''}`,
    item.keyword,
    item.frequency,
    `${item.density.toFixed(2)}%`,
  ]);

  return buildCsv(headers, rows);
}

export function generatePlacementCsv(placement: PlacementResult[]): string {
  const headers = [
    'Target Keyword',
    'Meta Title',
    'Meta Description',
    'H1',
    'H2',
    'H3',
    'H4-H6',
    'Body Content',
    'Anchor Text',
    'Image Alt Text',
    'URL Path',
  ];

  const fmt = (v: number | null) => (v === null ? 'N/A' : v);

  const rows = placement.map((p) => [
    p.keyword,
    fmt(p.title),
    fmt(p.metaDescription),
    fmt(p.h1),
    fmt(p.h2),
    fmt(p.h3),
    fmt(p.h4To6),
    p.body,
    fmt(p.anchors),
    fmt(p.altText),
    p.urlPath,
  ]);

  return buildCsv(headers, rows);
}

export function generateCompleteReportCsv(
  result: KeywordDensityAnalysisResult,
  customKeywords: TargetKeywordResult[],
  placement?: PlacementResult[]
): string {
  const source = getSourceLabel(result);
  const scope = getScopeLabel(result);
  const placementMap = new Map<string, PlacementResult>();
  if (placement) {
    for (const p of placement) {
      placementMap.set(p.keyword, p);
    }
  }

  const headers = [
    'Source URL',
    'Content Scope',
    'Total Analysed Words',
    'Target Keyword',
    'Word Count',
    'Frequency',
    'Density Percentage',
    'Status',
    'Q1 (0-25%)',
    'Q2 (25-50%)',
    'Q3 (50-75%)',
    'Q4 (75-100%)',
    'Meta Title',
    'Meta Description',
    'H1',
    'H2',
    'H3',
    'H4-H6',
    'Body Content',
    'Anchor Text',
    'Image Alt Text',
    'URL Path',
  ];

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? 'N/A' : v);

  const rows = customKeywords.map((kw) => {
    const p = placementMap.get(kw.keyword);
    return [
      source,
      scope,
      result.totalWords,
      kw.keyword,
      kw.wordCount,
      kw.frequency,
      `${kw.density.toFixed(2)}%`,
      kw.status,
      kw.distribution[0],
      kw.distribution[1],
      kw.distribution[2],
      kw.distribution[3],
      p ? fmt(p.title) : 'N/A',
      p ? fmt(p.metaDescription) : 'N/A',
      p ? fmt(p.h1) : 'N/A',
      p ? fmt(p.h2) : 'N/A',
      p ? fmt(p.h3) : 'N/A',
      p ? fmt(p.h4To6) : 'N/A',
      p ? p.body : kw.frequency,
      p ? fmt(p.anchors) : 'N/A',
      p ? fmt(p.altText) : 'N/A',
      p ? p.urlPath : 'N/A',
    ];
  });

  return buildCsv(headers, rows);
}
