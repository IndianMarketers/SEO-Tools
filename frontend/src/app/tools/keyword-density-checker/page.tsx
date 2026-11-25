import React from 'react';
import Link from 'next/link';
import ToolLayout from '@/components/ToolLayout';
import { TOOLS_REGISTRY } from '@/lib/seo/seoConfig';
import KeywordDensityClient from './KeywordDensityClient';

export default function KeywordDensityCheckerPage() {
  const toolConfig = TOOLS_REGISTRY['keyword-density-checker'];

  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'SEO Tools', href: '/tools' },
    { label: 'Keyword Density Checker' },
  ];

  const howItWorks = [
    'Select Analyse URL or Paste Text.',
    'Enter the webpage URL or paste the content you want to analyse.',
    'Enter specific target keywords if required.',
    'Choose the appropriate content extraction scope.',
    'Click Analyse Keyword Density.',
    'Review keyword frequency, density, placement and contextual usage.',
    'Download the results for further SEO analysis. Users can also add additional target keywords after the initial analysis without fetching the webpage again.',
  ];

  const aboutText = (
    <div className="space-y-4 text-[var(--im-text)] text-sm sm:text-base leading-relaxed">
      <p>
        A keyword density checker is a tool that measures how often a specific word or phrase appears in a piece of content relative to its total word count. It helps SEO professionals, content writers and website owners understand keyword usage and identify frequently occurring words and phrases.
      </p>
      <p>
        Indian Marketers&apos; online keyword density checker works as both a website keyword density checker and a text-based keyword counter tool. Users can automatically discover frequently used words and phrases or enter specific target keywords to check their exact frequency, density and placement.
      </p>
      <p>
        Unlike tools that only display commonly occurring words, this keyword density analysis tool also reports target keywords that are missing from the analysed content. While keyword density measures exact keyword frequency, our{' '}
        <Link href="/tools/page-focus-analyzer" className="text-[var(--im-primary-deep)] font-semibold hover:underline">
          AI Page Focus Analyzer
        </Link>{' '}
        helps evaluate the broader topical relevance and semantic coverage of webpage content.
      </p>
    </div>
  );

  const extraSections = (
    <>
      <section>
        <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-[var(--im-heading)] mb-3">
          How Is Keyword Density Calculated?
        </h2>
        <div className="space-y-3 text-sm sm:text-base text-[var(--im-text)] leading-relaxed">
          <p>
            Keyword density is calculated by dividing the number of keyword occurrences by the total number of analysed words and multiplying the result by 100.
          </p>
          <p className="font-mono text-xs sm:text-sm bg-[var(--im-bg-soft)] border border-[var(--im-border)] rounded-lg px-4 py-3 text-[var(--im-heading)]">
            Keyword Density (%) = (Keyword Occurrences / Total Words) × 100
          </p>
          <p>
            For example, if a keyword appears 10 times in a 1,000-word article, this keyword density calculator reports a density of 1.00%. The keyword occurrence checker uses exact word and phrase matching to calculate frequency—multi-word phrases are counted as individual occurrences, while the total word count remains the denominator.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-[var(--im-heading)] mb-3">
          Automatic Keyword Discovery vs Custom Keyword Analysis
        </h2>
        <div className="space-y-3 text-sm sm:text-base text-[var(--im-text)] leading-relaxed">
          <p>
            Automatic keyword discovery identifies frequently occurring individual words and multi-word phrases within content.
          </p>
          <p>
            Custom keyword analysis allows users to enter their actual target keywords and check whether those exact terms appear in the content, how frequently they occur and where they are used.
          </p>
          <p>
            Both methods are useful for content audits, competitor analysis and reviewing content optimization.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-[var(--im-heading)] mb-3">
          Why Analyse Keyword Placement?
        </h2>
        <div className="space-y-3 text-sm sm:text-base text-[var(--im-text)] leading-relaxed">
          <p>
            Keyword frequency alone does not explain where a keyword appears within a webpage. Reviewing keyword placement across page titles, meta descriptions, headings, body content, anchor text and image alt attributes provides additional information about how a page communicates its subject.
          </p>
          <p>
            This can help SEO professionals identify content gaps, inconsistent terminology and opportunities to make page content clearer.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[var(--im-bg-soft)] border border-[var(--im-border)] rounded-xl sm:rounded-2xl p-5">
          <h2 className="text-base sm:text-lg font-bold text-[var(--im-heading)] mb-2.5">
            What Is the Ideal Keyword Density for SEO?
          </h2>
          <p className="text-xs sm:text-sm text-[var(--im-text)] leading-relaxed mb-2.5">
            There is no universally recommended keyword density percentage for Google Search. A keyword may appear several times in one article and only a few times in another, depending on the topic, content length and writing style.
          </p>
          <p className="text-xs sm:text-sm text-[var(--im-text)] leading-relaxed">
            The focus should remain on creating useful, relevant and naturally written content. Keyword density should be used as a diagnostic metric rather than a fixed ranking target.
          </p>
        </div>

        <div className="bg-[var(--im-bg-soft)] border border-[var(--im-border)] rounded-xl sm:rounded-2xl p-5">
          <h2 className="text-base sm:text-lg font-bold text-[var(--im-heading)] mb-2.5">
            How to Identify Potential Keyword Stuffing
          </h2>
          <p className="text-xs sm:text-sm text-[var(--im-text)] leading-relaxed mb-2.5">
            Frequently repeated terms may warrant an editorial review, particularly when repetition makes sentences unnatural or difficult to read.
          </p>
          <p className="text-xs sm:text-sm text-[var(--im-text)] leading-relaxed">
            A keyword density checker helps identify repeated words and phrases and inspect the context in which they appear. However, a high keyword density percentage alone does not establish that a webpage contains keyword stuffing.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-[var(--im-heading)] mb-3">
          Who Can Use the Keyword Density Checker?
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm text-[var(--im-text)]">
          {[
            'SEO executives conducting on-page audits.',
            'Content writers reviewing articles before publication.',
            'Digital marketing agencies auditing client websites.',
            'Website owners reviewing landing page content.',
            'Ecommerce teams analysing product descriptions.',
            'Marketers conducting competitor content analysis.',
            'Editors identifying unnecessary keyword repetition.',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5 bg-[var(--im-bg-soft)] border border-[var(--im-border)] rounded-lg px-3.5 py-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--im-primary-deep)] mt-2 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );

  const relatedTools = [
    {
      name: 'AI Page Focus & Semantic Relevance Analyzer',
      href: '/tools/page-focus-analyzer',
      desc: 'Evaluate topical focus, semantic relevance and content gaps across webpages.',
    },
    {
      name: 'SERP Simulator',
      href: '/tools/serp-simulator',
      desc: 'Preview title tags and meta descriptions in desktop and mobile search results.',
    },
    {
      name: 'Fetch & Render',
      href: '/tools/fetch-render',
      desc: 'Inspect how search engines render JavaScript content on your webpages.',
    },
    {
      name: 'Pre-rendering Tester',
      href: '/tools/prerendering-tester',
      desc: 'Compare raw source HTML against rendered DOM across crawler user agents.',
    },
    {
      name: 'Bulk Google Index Checker',
      href: '/tools/bulk-google-index-checker',
      desc: 'Check Google indexing status and inspect live page titles and descriptions.',
    },
  ];

  return (
    <ToolLayout
      title="Free Keyword Density Checker"
      description="Use Indian Marketers' free Keyword Density Checker to analyse keyword frequency, density and placement across any webpage or text content. Discover frequently used keywords, check specific target phrases and review keyword usage to support on-page SEO and content optimization."
      category="Content & Semantic SEO"
      breadcrumbs={breadcrumbs}
      aboutTitle="What Is a Keyword Density Checker?"
      aboutText={aboutText}
      howItWorksTitle="How to Use the Free Keyword Density Checker"
      howItWorks={howItWorks}
      extraSections={extraSections}
      faq={toolConfig.faqs}
      relatedTools={relatedTools}
    >
      <KeywordDensityClient />
    </ToolLayout>
  );
}
