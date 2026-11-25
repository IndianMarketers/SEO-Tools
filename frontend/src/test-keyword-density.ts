import { NextRequest } from 'next/server';
import {
  analyzePlainText,
  analyzeSegments,
  parseTargetKeywords,
} from './lib/seo/keyword-density/analyzer';
import { extractHtmlForKeywordDensity } from './lib/seo/keyword-density/htmlExtractor';
import {
  buildHighlightedParts,
  findKeywordContextMatches,
} from './lib/seo/keyword-density/contextFinder';
import {
  escapeCsvCell,
  generateAutoKeywordsCsv,
  generateCompleteReportCsv,
  generatePlacementCsv,
  generateTargetKeywordsCsv,
} from './lib/seo/keyword-density/csvExporter';
import {
  getToolJsonLd,
  getToolMetadata,
  getToolsHubJsonLd,
  TOOLS_REGISTRY,
} from './lib/seo/seoConfig';
import { NAVIGATION_TOOLS } from './lib/toolsList';
import { POST as keywordDensityPost } from './app/api/seo/keyword-density-checker/route';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${msg}`);
    failed++;
  }
}

function approxEqual(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

async function run() {
  console.log('=====================================================');
  console.log('KEYWORD DENSITY CHECKER — COMPREHENSIVE TEST SUITE');
  console.log('=====================================================\n');

  // Test Case 1 – Basic Frequency
  console.log('1. Basic Frequency & Density:');
  {
    const res = analyzePlainText({
      text: 'land land plot property',
      targetKeywordsInput: 'land\nplot',
    });
    assert(res.totalWords === 4, 'TC1: Total words is 4');
    const land = res.customKeywords.find((k) => k.keyword === 'land')!;
    const plot = res.customKeywords.find((k) => k.keyword === 'plot')!;
    assert(land.frequency === 2 && approxEqual(land.density, 50.0), 'TC1: land frequency 2, density 50.00%');
    assert(plot.frequency === 1 && approxEqual(plot.density, 25.0), 'TC1: plot frequency 1, density 25.00%');
  }

  // Test Case 2 – Case Insensitivity
  console.log('\n2. Case Insensitivity:');
  {
    const res = analyzePlainText({
      text: 'Goa goa GOA',
      targetKeywordsInput: 'Goa',
    });
    assert(res.totalWords === 3, 'TC2: Total words is 3');
    assert(res.customKeywords[0].frequency === 3, 'TC2: Frequency is 3');
    assert(approxEqual(res.customKeywords[0].density, 100.0), 'TC2: Density is 100.00%');
  }

  // Test Case 3 – Exact Word Matching
  console.log('\n3. Exact Word Matching:');
  {
    const res = analyzePlainText({
      text: 'land landmark mainland landscape land',
      targetKeywordsInput: 'land',
    });
    assert(res.totalWords === 5, 'TC3: Total words is 5');
    assert(res.customKeywords[0].frequency === 2, 'TC3: Frequency is 2 (excludes landmark, mainland, landscape)');
    assert(approxEqual(res.customKeywords[0].density, 40.0), 'TC3: Density is 40.00%');
  }

  // Test Case 4 – Exact Multi-Word Phrase
  console.log('\n4. Exact Multi-Word Phrase:');
  {
    const res = analyzePlainText({
      text: 'plots in Goa plots in Goa are popular',
      targetKeywordsInput: 'plots in Goa',
    });
    assert(res.totalWords === 8, 'TC4: Total words is 8');
    assert(res.customKeywords[0].frequency === 2, 'TC4: Frequency is 2');
    assert(approxEqual(res.customKeywords[0].density, 25.0), 'TC4: Density is 25.00%');
  }

  // Test Case 5 – Zero Occurrences
  console.log('\n5. Zero Occurrences:');
  {
    const res = analyzePlainText({
      text: 'Residential plots in Goa',
      targetKeywordsInput: 'luxury villas',
    });
    assert(res.customKeywords[0].frequency === 0, 'TC5: Frequency is 0');
    assert(res.customKeywords[0].density === 0, 'TC5: Density is 0.00%');
    assert(res.customKeywords[0].status === 'Not Found', 'TC5: Status is Not Found');
  }

  // Test Case 6 – Singular and Plural
  console.log('\n6. Singular and Plural:');
  {
    const res = analyzePlainText({
      text: 'plot plots plot',
      targetKeywordsInput: 'plot',
    });
    assert(res.totalWords === 3, 'TC6: Total words is 3');
    assert(res.customKeywords[0].frequency === 2, 'TC6: Frequency is 2');
    assert(approxEqual(res.customKeywords[0].density, 66.67), 'TC6: Density is 66.67%');
  }

  // Test Case 7 – Stop Word Denominator
  console.log('\n7. Stop Word Denominator:');
  {
    const res = analyzePlainText({
      text: 'the land in Goa',
      targetKeywordsInput: 'land',
      stopWordsExcluded: true,
    });
    assert(res.totalWords === 4, 'TC7: Total words includes stop words (4)');
    assert(res.customKeywords[0].frequency === 1, 'TC7: Frequency is 1');
    assert(approxEqual(res.customKeywords[0].density, 25.0), 'TC7: Density is 25.00%');
    const auto1 = res.autoKeywords[1].map((k) => k.keyword);
    assert(!auto1.includes('the') && !auto1.includes('in'), 'TC7: Stop words excluded from 1-word auto discovery');
  }

  // Test Case 8 – Overlapping Phrase
  console.log('\n8. Overlapping Phrase:');
  {
    const res = analyzePlainText({
      text: 'land land land',
      targetKeywordsInput: 'land land',
    });
    assert(res.totalWords === 3, 'TC8: Total words is 3');
    assert(res.customKeywords[0].frequency === 2, 'TC8: Overlapping phrase frequency is 2');
    assert(approxEqual(res.customKeywords[0].density, 66.67), 'TC8: Density is 66.67%');
  }

  // Test Case 9 & 10 – Inline HTML vs Separate Paragraph Boundaries
  console.log('\n9. Inline HTML & Paragraph Boundaries:');
  {
    const inlineHtml = '<html><body><main><p>Premium <strong>plots in Goa</strong> are available.</p></main></body></html>';
    const extInline = extractHtmlForKeywordDensity(inlineHtml, 'https://example.com/goa', 'main');
    const resInline = analyzeSegments({
      mode: 'url',
      segments: extInline.segments,
      extractedText: extInline.extractedText,
      targetKeywordsInput: 'plots in Goa',
    });
    assert(resInline.customKeywords[0].frequency === 1, 'TC9: Inline <strong> preserves phrase match (frequency 1)');

    const paraHtml = '<html><body><main><p>Available plots</p><p>in Goa today</p></main></body></html>';
    const extPara = extractHtmlForKeywordDensity(paraHtml, 'https://example.com/goa', 'main');
    const resPara = analyzeSegments({
      mode: 'url',
      segments: extPara.segments,
      extractedText: extPara.extractedText,
      targetKeywordsInput: 'plots in Goa',
    });
    assert(resPara.customKeywords[0].frequency === 0, 'TC10: Separate paragraphs do NOT create artificial phrase match (frequency 0)');
  }

  // Test Case 11 – Automatic Keyword Discovery
  console.log('\n10. Automatic Keyword Discovery:');
  {
    const res = analyzePlainText({
      text: 'real estate investment real estate investment',
      minFrequency: 2,
    });
    const twoWords = new Map(res.autoKeywords[2].map((k) => [k.keyword, k.frequency]));
    const threeWords = new Map(res.autoKeywords[3].map((k) => [k.keyword, k.frequency]));
    assert(twoWords.get('real estate') === 2, 'TC11: "real estate" frequency is 2');
    assert(twoWords.get('estate investment') === 2, 'TC11: "estate investment" frequency is 2');
    assert(threeWords.get('real estate investment') === 2, 'TC11: "real estate investment" frequency is 2');
  }

  // Test Case 12 – Custom Keyword Deduplication
  console.log('\n11. Custom Keyword Deduplication:');
  {
    const parsed = parseTargetKeywords('Goa\ngoa\nGOA');
    assert(parsed.keywords.length === 1, 'TC12: Deduplicates to 1 unique keyword');
    assert(parsed.keywords[0] === 'Goa', 'TC12: Preserves first valid display value "Goa"');

    const csvParsed = parseTargetKeywords('"plots in Goa, India", luxury villas');
    assert(csvParsed.keywords.length === 2 && csvParsed.keywords[0] === 'plots in Goa, India', 'TC12b: Preserves commas inside quotes');
  }

  // Test Case 13 & 14 – Automatic + Custom Together & Add Target Without Re-fetching
  console.log('\n12. Automatic & Custom Together + Dynamic Target Addition:');
  {
    const res = analyzePlainText({
      text: 'plots in Goa are popular plots in Goa for investment',
      targetKeywordsInput: 'plots in Goa\ninvestment\nmissing keyword',
      minFrequency: 2,
    });
    assert(res.customKeywords.length === 3, 'TC13: All 3 custom target keywords returned');
    assert(res.customKeywords[2].status === 'Not Found', 'TC13: Missing keyword remains visible with Not Found');
    assert(res.autoKeywords[1].length > 0, 'TC13: Automatic discovery results also returned');

    // Simulate adding a new keyword to active segments
    const updated = analyzeSegments({
      mode: res.mode,
      segments: res.segments,
      extractedText: res.extractedText,
      targetKeywordsInput: ['plots in Goa', 'investment', 'missing keyword', 'popular'],
    });
    assert(updated.totalWords === res.totalWords, 'TC14: Total word count unchanged when adding target keyword');
    assert(updated.customKeywords.find((k) => k.keyword === 'popular')?.frequency === 1, 'TC14: Newly added keyword calculated accurately');
  }

  // Test Case 15 & 16 – Content Scope & Metadata Separation
  console.log('\n13. Content Scope & Metadata Separation:');
  {
    const fixtureHtml = `
      <html>
        <head>
          <title>Plots in Goa - Best Deals</title>
          <meta name="description" content="Find plots in Goa for investment.">
        </head>
        <body>
          <header><nav><a href="/home">Home Navigation</a> <a href="/goa">Plots in Goa Nav</a></nav></header>
          <main>
            <h1>Plots in Goa</h1>
            <p>Explore residential plots in Goa with clear titles.</p>
            <img src="goa-img.jpg" alt="Plots in Goa view" />
          </main>
          <footer><p>Copyright Footer Plots in Goa</p></footer>
        </body>
      </html>
    `;
    const mainExt = extractHtmlForKeywordDensity(fixtureHtml, 'https://example.com/plots-in-goa', 'main');
    const fullExt = extractHtmlForKeywordDensity(fixtureHtml, 'https://example.com/plots-in-goa', 'full');

    const mainRes = analyzeSegments({
      mode: 'url',
      segments: mainExt.segments,
      extractedText: mainExt.extractedText,
      targetKeywordsInput: 'plots in Goa',
      metadataSignals: mainExt.metadataSignals,
    });
    const fullRes = analyzeSegments({
      mode: 'url',
      segments: fullExt.segments,
      extractedText: fullExt.extractedText,
      targetKeywordsInput: 'plots in Goa',
      metadataSignals: fullExt.metadataSignals,
    });

    assert(mainRes.customKeywords[0].frequency === 2, 'TC15: Main scope excludes nav/footer (frequency 2: H1 + p)');
    assert(fullRes.customKeywords[0].frequency === 4, 'TC15: Full scope includes nav + footer (frequency 4)');
    assert(fullRes.totalWords > mainRes.totalWords, 'TC15: Full scope has larger word count denominator');

    const p = mainRes.placement![0];
    assert(p.title === 1 && p.metaDescription === 1 && p.h1 === 1 && p.body === 2 && p.altText === 1 && p.urlPath === 1,
      'TC16: Metadata, H1, Body, Alt Text, and URL Path counted independently without inflating body word count');
  }

  // Unicode, Hyphens, Apostrophes, Context Highlighting, CSV Injection
  console.log('\n14. Unicode, Hyphens, Context Highlighting & CSV Export:');
  {
    const res = analyzePlainText({
      text: "Co-working spaces and buyer's guides in Café Goa. Land and landmark.",
      targetKeywordsInput: "co-working\nbuyer's\ncafé\nland",
    });
    assert(res.customKeywords.every((k) => k.frequency === 1), 'Handles hyphens, apostrophes, Unicode, and exact boundaries');

    const matches = findKeywordContextMatches(res.segments, 'land');
    assert(matches.length === 1, 'Context finder locates segment');
    const parts = buildHighlightedParts(matches[0].text, 'land');
    const highlighted = parts.filter((p) => p.isMatch).map((p) => p.text);
    assert(highlighted.length === 1 && highlighted[0] === 'Land', 'Context highlighter preserves capitalization and ignores "landmark"');

    assert(escapeCsvCell('=CMD()') === "'=CMD()", 'CSV formula injection neutralized');
    const csv = generateTargetKeywordsCsv(res, res.customKeywords);
    assert(csv.includes('Target Keyword,Keyword Word Count,Frequency,Density Percentage,Status'), 'Target CSV has required headers');
    assert(generateAutoKeywordsCsv(res, 1).includes('Phrase Length,Keyword,Frequency,Density Percentage'), 'Auto CSV has required headers');
    assert(generatePlacementCsv([]).includes('Target Keyword,Meta Title,Meta Description'), 'Placement CSV has required headers');
    assert(generateCompleteReportCsv(res, res.customKeywords).includes('Q1 (0-25%)'), 'Complete CSV includes distribution');
  }

  // API Route Validation & SSRF Protection
  console.log('\n15. API Route Validation & SSRF Protection:');
  {
    const ssrfReq = new NextRequest('http://localhost:3000/api/seo/keyword-density-checker', {
      method: 'POST',
      body: JSON.stringify({ mode: 'url', url: 'http://127.0.0.1/secret' }),
    });
    const ssrfRes = await keywordDensityPost(ssrfReq);
    assert(ssrfRes.status === 403, 'API blocks localhost/loopback SSRF with 403');

    const ftpReq = new NextRequest('http://localhost:3000/api/seo/keyword-density-checker', {
      method: 'POST',
      body: JSON.stringify({ mode: 'url', url: 'ftp://example.com/file' }),
    });
    const ftpRes = await keywordDensityPost(ftpReq);
    assert(ftpRes.status === 400, 'API rejects unsupported ftp:// protocol with 400');

    const emptyReq = new NextRequest('http://localhost:3000/api/seo/keyword-density-checker', {
      method: 'POST',
      body: JSON.stringify({ mode: 'text', text: '   ' }),
    });
    const emptyRes = await keywordDensityPost(emptyReq);
    assert(emptyRes.status === 400, 'API rejects empty text input with 400');
  }

  // Tools Registry, Directory Count (21), SEO Metadata & Structured Data
  console.log('\n16. Tools Registry (21 tools), SEO Metadata & JSON-LD:');
  {
    const totalNavTools = NAVIGATION_TOOLS.reduce((acc, c) => acc + c.tools.length, 0);
    assert(totalNavTools === 21, `NAVIGATION_TOOLS has 21 tools (got ${totalNavTools})`);
    assert(Object.keys(TOOLS_REGISTRY).length === 21, `TOOLS_REGISTRY has 21 tools (got ${Object.keys(TOOLS_REGISTRY).length})`);

    const meta = getToolMetadata('keyword-density-checker');
    assert(meta.title === 'Free Keyword Density Checker Tool | Indian Marketers', 'Meta title matches spec');
    assert(meta.alternates?.canonical === 'https://indianmarketers.in/tools/keyword-density-checker', 'Canonical URL matches spec');

    const jsonLd = getToolJsonLd('keyword-density-checker') as { '@graph': Record<string, unknown>[] };
    const types = jsonLd['@graph'].map((e) => e['@type']);
    assert(
      types.includes('WebPage') && types.includes('WebApplication') && types.includes('BreadcrumbList') && types.includes('FAQPage'),
      'JSON-LD contains WebPage, WebApplication, BreadcrumbList, and FAQPage'
    );

    const hubJsonLd = getToolsHubJsonLd() as { '@graph': Record<string, unknown>[] };
    const itemList = hubJsonLd['@graph'].find((e) => e['@type'] === 'ItemList') as { numberOfItems: number };
    assert(itemList.numberOfItems === 21, 'Tools hub ItemList dynamically reports 21 tools');
  }

  console.log('\n=====================================================');
  console.log(`TOTAL KEYWORD DENSITY TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('=====================================================');
  if (failed > 0) process.exit(1);
}

run();
