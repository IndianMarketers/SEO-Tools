'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  analyzePlainText,
  analyzeSegments,
  MAX_TARGET_KEYWORDS,
  parseTargetKeywords,
} from '@/lib/seo/keyword-density/analyzer';
import { analyzeKeywordPlacement } from '@/lib/seo/keyword-density/placementAnalyzer';
import {
  generateAutoKeywordsCsv,
  generateCompleteReportCsv,
  generatePlacementCsv,
  generateTargetKeywordsCsv,
} from '@/lib/seo/keyword-density/csvExporter';
import type {
  AnalysisMode,
  AutoKeywordResult,
  ContentScope,
  ExtractionMethod,
  KeywordDensityAnalysisResult,
  PlacementResult,
} from '@/lib/seo/keyword-density/types';
import ContextModal from './ContextModal';

const MAX_PASTED_CHARS = 100_000;

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatExtractionMethod(method: ExtractionMethod): string {
  switch (method) {
    case 'server-html':
      return 'Server-rendered HTML';
    case 'js-rendered':
      return 'JavaScript-rendered content';
    case 'cleaned-body-fallback':
      return 'Cleaned body fallback';
    case 'manual-text':
      return 'Manually entered text';
  }
}

export default function KeywordDensityClient() {
  // Input state (preserved across mode switches)
  const [mode, setMode] = useState<AnalysisMode>('url');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [targetKeywordsInput, setTargetKeywordsInput] = useState('');
  const [contentScope, setContentScope] = useState<ContentScope>('main');
  const [stopWordsExcluded, setStopWordsExcluded] = useState(true);
  const [useJsRendering, setUseJsRendering] = useState(false);

  // Request & result state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KeywordDensityAnalysisResult | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Add more target keywords without re-fetching
  const [additionalKeywordsInput, setAdditionalKeywordsInput] = useState('');

  // Custom keywords table controls
  const [customSearch, setCustomSearch] = useState('');
  const [customFilter, setCustomFilter] = useState<'all' | 'found' | 'not-found'>('all');
  const [customSort, setCustomSort] = useState<'order' | 'freq-desc' | 'freq-asc' | 'density-desc' | 'alpha-asc'>('order');

  // Auto keywords table controls
  const [activeNgramTab, setActiveNgramTab] = useState<1 | 2 | 3 | 4>(1);
  const [autoSearch, setAutoSearch] = useState('');
  const [minFrequency, setMinFrequency] = useState<number>(2);
  const [autoSort, setAutoSort] = useState<'freq-desc' | 'freq-asc' | 'density-desc' | 'alpha-asc'>('freq-desc');
  const [rowsPerPage, setRowsPerPage] = useState<number>(25);
  const [autoPage, setAutoPage] = useState<number>(1);

  // Placement for auto-detected keywords when no custom keywords entered
  const [selectedAutoForPlacement, setSelectedAutoForPlacement] = useState<string[]>([]);

  // Context modal state
  const [contextTarget, setContextTarget] = useState<{ keyword: string; frequency: number; density: number } | null>(null);

  // Analysed content preview state
  const [showContentPreview, setShowContentPreview] = useState(false);
  const [previewCharLimit, setPreviewCharLimit] = useState(5000);

  // Copy feedback
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  // Live counts for Paste Text mode
  const liveTextStats = useMemo(() => {
    const chars = textInput.length;
    const words = textInput.trim() ? textInput.trim().split(/\s+/).filter(Boolean).length : 0;
    return { chars, words };
  }, [textInput]);

  // Live valid target keyword count
  const parsedTargetStats = useMemo(() => {
    return parseTargetKeywords(targetKeywordsInput, MAX_TARGET_KEYWORDS);
  }, [targetKeywordsInput]);

  function showCopied(key: string) {
    setCopiedFeedback(key);
    setTimeout(() => setCopiedFeedback(null), 2000);
  }

  function markSourceChanged() {
    if (result) setIsStale(true);
  }

  async function handleAnalyze(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (isLoading) return;

    setError(null);

    if (mode === 'url') {
      const trimmed = urlInput.trim();
      if (!trimmed) {
        setError('Please enter a webpage URL to analyse.');
        return;
      }
      const normalized = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
      try {
        const u = new URL(normalized);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setError('Only HTTP and HTTPS webpage URLs are supported.');
          return;
        }
      } catch {
        setError('Please enter a valid webpage URL (e.g. https://www.example.com/page).');
        return;
      }
    } else {
      if (!textInput.trim()) {
        setError('Please paste or enter content to analyse.');
        return;
      }
      if (textInput.length > MAX_PASTED_CHARS) {
        setError(`Content exceeds the maximum limit of ${MAX_PASTED_CHARS.toLocaleString()} characters.`);
        return;
      }
    }

    // Cancel any previous in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeqRef.current;

    setIsLoading(true);
    setIsStale(false);
    setAutoPage(1);
    setSelectedAutoForPlacement([]);

    try {
      let analysisData: KeywordDensityAnalysisResult;

      if (mode === 'text') {
        setLoadingStage('Calculating keyword frequencies...');
        analysisData = analyzePlainText({
          text: textInput,
          targetKeywordsInput,
          stopWordsExcluded,
          minFrequency,
        });
        if (analysisData.totalWords === 0) {
          throw new Error('No readable words were found in the entered text.');
        }
      } else {
        setLoadingStage('Fetching webpage content...');
        const res = await fetch('/api/seo/keyword-density-checker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            mode: 'url',
            url: urlInput.trim(),
            targetKeywords: targetKeywordsInput,
            contentScope,
            stopWordsExcluded,
            minFrequency,
            useJsRendering,
          }),
        });

        setLoadingStage('Preparing keyword analysis...');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Failed to analyse webpage (HTTP ${res.status}).`);
        }
        analysisData = data as KeywordDensityAnalysisResult;
      }

      if (seq !== requestSeqRef.current) return;
      setResult(analysisData);
      setPreviewCharLimit(5000);
      setShowContentPreview(false);

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (seq !== requestSeqRef.current) return;
      setResult(null);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred during analysis.');
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoading(false);
        setLoadingStage('');
      }
    }
  }

  function handleReset() {
    if (abortRef.current) abortRef.current.abort();
    setUrlInput('');
    setTextInput('');
    setTargetKeywordsInput('');
    setAdditionalKeywordsInput('');
    setContentScope('main');
    setStopWordsExcluded(true);
    setUseJsRendering(false);
    setMinFrequency(2);
    setResult(null);
    setIsStale(false);
    setError(null);
    setCustomSearch('');
    setCustomFilter('all');
    setAutoSearch('');
    setAutoPage(1);
    setSelectedAutoForPlacement([]);
    setContextTarget(null);
  }

  /**
   * Re-computes custom & automatic keyword results locally using active extracted segments
   * without making any new network request.
   */
  function recomputeWithNewTargets(newTargetKeywords: string[], nextMinFreq = minFrequency, nextStopWords = stopWordsExcluded) {
    if (!result) return;
    const recomputed = analyzeSegments({
      mode: result.mode,
      segments: result.segments,
      extractedText: result.extractedText,
      targetKeywordsInput: newTargetKeywords,
      stopWordsExcluded: nextStopWords,
      minFrequency: nextMinFreq,
      contentScope: result.contentScope,
      extractionMethod: result.extractionMethod,
      requestedUrl: result.requestedUrl,
      finalUrl: result.finalUrl,
      httpStatus: result.httpStatus,
      metadataSignals: result.metadataSignals,
      warnings: result.warnings,
      isTruncated: result.isTruncated,
      jsRenderAvailable: result.jsRenderAvailable,
    });
    setResult(recomputed);
  }

  function handleAddMoreKeywords() {
    if (!result || !additionalKeywordsInput.trim()) return;
    const existing = result.customKeywords.map((c) => c.keyword);
    const { keywords: newlyParsed } = parseTargetKeywords(additionalKeywordsInput, MAX_TARGET_KEYWORDS);
    if (newlyParsed.length === 0) return;

    const combined = [...existing, ...newlyParsed];
    const { keywords: deduped } = parseTargetKeywords(combined, MAX_TARGET_KEYWORDS);
    setTargetKeywordsInput(deduped.join('\n'));
    setAdditionalKeywordsInput('');
    recomputeWithNewTargets(deduped);
  }

  function handleAddAutoKeywordToTargets(kw: string) {
    if (!result) return;
    const existing = result.customKeywords.map((c) => c.keyword);
    const { keywords: deduped } = parseTargetKeywords([...existing, kw], MAX_TARGET_KEYWORDS);
    setTargetKeywordsInput(deduped.join('\n'));
    recomputeWithNewTargets(deduped);
  }

  function handleRemoveTargetKeyword(kwToRemove: string) {
    if (!result) return;
    const remaining = result.customKeywords
      .filter((c) => c.keyword !== kwToRemove)
      .map((c) => c.keyword);
    setTargetKeywordsInput(remaining.join('\n'));
    recomputeWithNewTargets(remaining);
  }

  function handleMinFrequencyChange(newMin: number) {
    const valid = Math.max(1, Math.min(100, Math.floor(newMin) || 1));
    setMinFrequency(valid);
    setAutoPage(1);
    if (result) {
      recomputeWithNewTargets(
        result.customKeywords.map((c) => c.keyword),
        valid,
        stopWordsExcluded
      );
    }
  }

  // Filtered & sorted custom keywords
  const filteredCustomKeywords = useMemo(() => {
    if (!result) return [];
    let list = [...result.customKeywords];
    if (customFilter === 'found') list = list.filter((k) => k.frequency > 0);
    if (customFilter === 'not-found') list = list.filter((k) => k.frequency === 0);
    if (customSearch.trim()) {
      const q = customSearch.trim().toLowerCase();
      list = list.filter((k) => k.keyword.toLowerCase().includes(q));
    }
    if (customSort === 'freq-desc') list.sort((a, b) => b.frequency - a.frequency || a.keyword.localeCompare(b.keyword));
    if (customSort === 'freq-asc') list.sort((a, b) => a.frequency - b.frequency || a.keyword.localeCompare(b.keyword));
    if (customSort === 'density-desc') list.sort((a, b) => b.density - a.density || a.keyword.localeCompare(b.keyword));
    if (customSort === 'alpha-asc') list.sort((a, b) => a.keyword.localeCompare(b.keyword));
    return list;
  }, [result, customFilter, customSearch, customSort]);

  // Filtered & sorted auto keywords for active n-gram tab
  const filteredAutoKeywords = useMemo(() => {
    if (!result) return [];
    let list: AutoKeywordResult[] = [...result.autoKeywords[activeNgramTab]];
    if (autoSearch.trim()) {
      const q = autoSearch.trim().toLowerCase();
      list = list.filter((k) => k.keyword.toLowerCase().includes(q));
    }
    if (autoSort === 'freq-desc') list.sort((a, b) => b.frequency - a.frequency || a.keyword.localeCompare(b.keyword));
    if (autoSort === 'freq-asc') list.sort((a, b) => a.frequency - b.frequency || a.keyword.localeCompare(b.keyword));
    if (autoSort === 'density-desc') list.sort((a, b) => b.density - a.density || a.keyword.localeCompare(b.keyword));
    if (autoSort === 'alpha-asc') list.sort((a, b) => a.keyword.localeCompare(b.keyword));
    return list;
  }, [result, activeNgramTab, autoSearch, autoSort]);

  const totalAutoPages = Math.max(1, Math.ceil(filteredAutoKeywords.length / rowsPerPage));
  const paginatedAutoKeywords = useMemo(() => {
    const start = (autoPage - 1) * rowsPerPage;
    return filteredAutoKeywords.slice(start, start + rowsPerPage);
  }, [filteredAutoKeywords, autoPage, rowsPerPage]);

  // Placement rows (custom keywords, OR selected auto keywords when no custom keywords)
  const activePlacementRows: PlacementResult[] = useMemo(() => {
    if (!result || result.mode !== 'url' || !result.metadataSignals) return [];
    if (result.placement && result.placement.length > 0) return result.placement;
    if (selectedAutoForPlacement.length === 0) return [];
    const autoMap = new Map<string, number>();
    ([1, 2, 3, 4] as const).forEach((n) => {
      for (const item of result.autoKeywords[n]) {
        autoMap.set(item.keyword, item.frequency);
      }
    });
    return analyzeKeywordPlacement(
      selectedAutoForPlacement.map((kw) => ({ keyword: kw, bodyFrequency: autoMap.get(kw) || 0 })),
      result.metadataSignals
    );
  }, [result, selectedAutoForPlacement]);

  // Deterministic SEO insights
  const insights = useMemo(() => {
    if (!result) return [];
    const list: string[] = [];
    const custom = result.customKeywords;

    if (custom.length > 0) {
      const found = custom.filter((k) => k.frequency > 0);
      const notFound = custom.filter((k) => k.frequency === 0);
      list.push(`${found.length} of your ${custom.length} target keyword${custom.length === 1 ? ' was' : 's were'} found in the analysed content.`);
      if (notFound.length > 0) {
        list.push(`${notFound.length} target keyword${notFound.length === 1 ? ' was' : 's were'} not found.`);
      }
      if (found.length > 0) {
        const top = [...found].sort((a, b) => b.frequency - a.frequency)[0];
        list.push(`The most frequently occurring target keyword is "${top.keyword}" (${top.frequency} occurrence${top.frequency === 1 ? '' : 's'}, ${top.density.toFixed(2)}%).`);

        // Quarter concentration insight
        if (top.frequency >= 3) {
          const maxQ = Math.max(...top.distribution);
          const qIdx = top.distribution.indexOf(maxQ);
          if (maxQ / top.frequency >= 0.6) {
            const labels = ['first quarter', 'second quarter', 'third quarter', 'final quarter'];
            list.push(`The keyword "${top.keyword}" is concentrated in the ${labels[qIdx]} of the content (${maxQ} of ${top.frequency} occurrences).`);
          }
        }
      }
    }

    if (activePlacementRows.length > 0) {
      for (const p of activePlacementRows.slice(0, 3)) {
        if ((p.title ?? 0) > 0 && p.h1 === 0) {
          list.push(`The keyword "${p.keyword}" appears in the page title but not in the H1.`);
          break;
        }
      }
    }

    if (custom.length === 0 && result.autoKeywords[1].length > 0) {
      const top1 = result.autoKeywords[1][0];
      list.push(`The most frequent single word detected is "${top1.keyword}" (${top1.frequency} occurrences, ${top1.density.toFixed(2)}%).`);
    }

    return list;
  }, [result, activePlacementRows]);

  const targetFoundCount = result ? result.customKeywords.filter((k) => k.frequency > 0).length : 0;

  return (
    <div className="space-y-6">
      {/* Input Card */}
      <form
        onSubmit={handleAnalyze}
        className="bg-[var(--im-surface)] border border-[var(--im-border)] rounded-2xl p-5 sm:p-7 shadow-[var(--im-shadow-sm)] space-y-5"
      >
        {/* Mode Switcher */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--im-border)] pb-4" role="tablist" aria-label="Analysis Mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'url'}
            onClick={() => { setMode('url'); setError(null); }}
            className={`px-4 py-2 rounded-[var(--im-radius-sm)] text-sm font-semibold transition-all cursor-pointer ${
              mode === 'url'
                ? 'bg-[var(--im-primary)] text-white shadow-xs'
                : 'bg-[var(--im-bg-soft)] text-[var(--im-text)] border border-[var(--im-border)] hover:border-[var(--im-primary-deep)]'
            }`}
          >
            Analyse URL
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'text'}
            onClick={() => { setMode('text'); setError(null); }}
            className={`px-4 py-2 rounded-[var(--im-radius-sm)] text-sm font-semibold transition-all cursor-pointer ${
              mode === 'text'
                ? 'bg-[var(--im-primary)] text-white shadow-xs'
                : 'bg-[var(--im-bg-soft)] text-[var(--im-text)] border border-[var(--im-border)] hover:border-[var(--im-primary-deep)]'
            }`}
          >
            Paste Text
          </button>
        </div>

        {/* Mode A: URL Input */}
        {mode === 'url' ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="kd-url-input" className="block text-sm font-semibold text-[var(--im-heading)] mb-1.5">
                Webpage URL
              </label>
              <input
                id="kd-url-input"
                type="text"
                inputMode="url"
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); markSourceChanged(); }}
                placeholder="https://www.example.com/page"
                className="w-full px-4 py-3 rounded-[var(--im-radius-sm)] bg-[var(--im-bg-soft)] border border-[var(--im-border)] focus:border-[var(--im-primary)] focus:ring-3 focus:ring-[var(--im-accent-tint)] focus:outline-none text-sm sm:text-base text-[var(--im-text)]"
              />
            </div>

            {/* Content Extraction Settings */}
            <div className="bg-[var(--im-bg-soft)] border border-[var(--im-border)] rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--im-text-muted)]">
                Content Extraction Settings
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-surface)] cursor-pointer">
                  <input
                    type="radio"
                    name="contentScope"
                    value="main"
                    checked={contentScope === 'main'}
                    onChange={() => { setContentScope('main'); markSourceChanged(); }}
                    className="mt-0.5 accent-[#47A048]"
                  />
                  <div>
                    <div className="text-sm font-semibold text-[var(--im-heading)]">Main Content Only (Default)</div>
                    <div className="text-xs text-[var(--im-text-muted)]">Excludes navigation, headers, footers, cookie banners, ads &amp; sidebars.</div>
                  </div>
                </label>
                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-surface)] cursor-pointer">
                  <input
                    type="radio"
                    name="contentScope"
                    value="full"
                    checked={contentScope === 'full'}
                    onChange={() => { setContentScope('full'); markSourceChanged(); }}
                    className="mt-0.5 accent-[#47A048]"
                  />
                  <div>
                    <div className="text-sm font-semibold text-[var(--im-heading)]">Full Visible Page Content</div>
                    <div className="text-xs text-[var(--im-text-muted)]">Analyses all visible body text including navigation, headers &amp; footers.</div>
                  </div>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-5 pt-1">
                <label className="inline-flex items-center gap-2 text-sm text-[var(--im-text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stopWordsExcluded}
                    onChange={(e) => setStopWordsExcluded(e.target.checked)}
                    className="w-4 h-4 accent-[#47A048] rounded"
                  />
                  <span className="font-medium">Exclude Common Stop Words</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-[var(--im-text)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useJsRendering}
                    onChange={(e) => { setUseJsRendering(e.target.checked); markSourceChanged(); }}
                    className="w-4 h-4 accent-[#47A048] rounded"
                  />
                  <span className="font-medium">Use JS Rendering Fallback (for SPAs)</span>
                </label>
              </div>
            </div>
          </div>
        ) : (
          /* Mode B: Paste Text */
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="kd-text-input" className="block text-sm font-semibold text-[var(--im-heading)]">
                Enter Your Content
              </label>
              <div className="text-xs text-[var(--im-text-muted)] font-medium">
                <span>{liveTextStats.words.toLocaleString()} words</span>
                <span className="mx-1.5">&middot;</span>
                <span className={liveTextStats.chars >= MAX_PASTED_CHARS ? 'text-red-600 font-bold' : ''}>
                  {liveTextStats.chars.toLocaleString()} / {MAX_PASTED_CHARS.toLocaleString()} chars
                </span>
              </div>
            </div>
            <textarea
              id="kd-text-input"
              rows={7}
              maxLength={MAX_PASTED_CHARS}
              value={textInput}
              onChange={(e) => { setTextInput(e.target.value); markSourceChanged(); }}
              placeholder="Paste your article, blog, landing page or website content here..."
              className="w-full px-4 py-3 rounded-[var(--im-radius-sm)] bg-[var(--im-bg-soft)] border border-[var(--im-border)] focus:border-[var(--im-primary)] focus:ring-3 focus:ring-[var(--im-accent-tint)] focus:outline-none text-sm text-[var(--im-text)] leading-relaxed"
            />
            {liveTextStats.chars >= MAX_PASTED_CHARS && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Maximum input limit of {MAX_PASTED_CHARS.toLocaleString()} characters reached.
              </p>
            )}
            <label className="inline-flex items-center gap-2 text-sm text-[var(--im-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={stopWordsExcluded}
                onChange={(e) => setStopWordsExcluded(e.target.checked)}
                className="w-4 h-4 accent-[#47A048] rounded"
              />
              <span className="font-medium">Exclude Common Stop Words (for automatic discovery)</span>
            </label>
          </div>
        )}

        {/* Mandatory Custom Target Keyword Input */}
        <div className="pt-2 border-t border-[var(--im-border)]">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label htmlFor="kd-target-keywords" className="block text-sm font-semibold text-[var(--im-heading)]">
              Target Keywords (Optional)
            </label>
            <span className="text-xs text-[var(--im-text-muted)] font-medium">
              {parsedTargetStats.keywords.length} / {MAX_TARGET_KEYWORDS} valid keywords
            </span>
          </div>
          <textarea
            id="kd-target-keywords"
            rows={4}
            value={targetKeywordsInput}
            onChange={(e) => setTargetKeywordsInput(e.target.value)}
            placeholder={`Enter one keyword per line.\n\nExample:\nplots in Goa\nland for sale in Goa\nresidential plots in Goa\nGoa property`}
            className="w-full px-4 py-2.5 rounded-[var(--im-radius-sm)] bg-[var(--im-bg-soft)] border border-[var(--im-border)] focus:border-[var(--im-primary)] focus:ring-3 focus:ring-[var(--im-accent-tint)] focus:outline-none text-sm text-[var(--im-text)]"
          />
          <p className="text-xs text-[var(--im-text-muted)] mt-1.5">
            Enter the specific keywords or phrases you want to check (one per line or comma-separated). Leave this field empty for automatic keyword discovery.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isLoading}
            className="px-6 py-3 rounded-[var(--im-radius-sm)] bg-[var(--im-primary)] hover:bg-[var(--im-primary-deep)] disabled:opacity-60 text-white font-semibold text-sm sm:text-base shadow-xs transition-all cursor-pointer inline-flex items-center gap-2"
          >
            {isLoading && (
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {isLoading ? (loadingStage || 'Analysing...') : 'Analyse Keyword Density'}
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={isLoading}
            className="px-5 py-3 rounded-[var(--im-radius-sm)] bg-[var(--im-bg-soft)] hover:bg-[var(--im-border)]/50 border border-[var(--im-border)] text-[var(--im-heading)] font-semibold text-sm sm:text-base transition-colors cursor-pointer"
          >
            Reset
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
            <strong className="font-semibold">Analysis Error:</strong> {error}
          </div>
        )}
      </form>

      {/* Results Section */}
      {result && (
        <div ref={resultsRef} className="space-y-6">
          {isStale && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs sm:text-sm font-medium">
              Source inputs or extraction scope changed. Click <strong>Analyse Keyword Density</strong> to update results for the new source.
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm space-y-1">
              {result.warnings.map((w, idx) => (
                <p key={idx}>&#9888; {w}</p>
              ))}
            </div>
          )}

          {/* Analysis Overview */}
          <section className="bg-[var(--im-surface)] border border-[var(--im-border)] rounded-2xl p-5 sm:p-7 shadow-[var(--im-shadow-sm)] space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg sm:text-xl font-bold text-[var(--im-heading)]">Analysis Overview</h2>
              {result.customKeywords.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(
                      generateCompleteReportCsv(result, result.customKeywords, activePlacementRows),
                      'keyword-density-complete-report.csv',
                      'text/csv;charset=utf-8;'
                    )
                  }
                  className="px-3.5 py-2 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] hover:border-[var(--im-primary-deep)] text-xs font-semibold text-[var(--im-heading)] transition-colors cursor-pointer"
                >
                  Export Complete Report (CSV)
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3.5 rounded-xl bg-[var(--im-bg-soft)] border border-[var(--im-border)]">
                <div className="text-xs text-[var(--im-text-muted)] font-medium">Total Words</div>
                <div className="text-xl font-bold text-[var(--im-heading)] mt-0.5">{result.totalWords.toLocaleString()}</div>
              </div>
              <div className="p-3.5 rounded-xl bg-[var(--im-bg-soft)] border border-[var(--im-border)]">
                <div className="text-xs text-[var(--im-text-muted)] font-medium">Unique Words</div>
                <div className="text-xl font-bold text-[var(--im-heading)] mt-0.5">{result.uniqueWords.toLocaleString()}</div>
              </div>
              <div className="p-3.5 rounded-xl bg-[var(--im-bg-soft)] border border-[var(--im-border)]">
                <div className="text-xs text-[var(--im-text-muted)] font-medium">Total Characters</div>
                <div className="text-xl font-bold text-[var(--im-heading)] mt-0.5">{result.totalCharacters.toLocaleString()}</div>
              </div>
              <div className="p-3.5 rounded-xl bg-[var(--im-bg-soft)] border border-[var(--im-border)]">
                <div className="text-xs text-[var(--im-text-muted)] font-medium">Auto Keywords</div>
                <div className="text-xl font-bold text-[var(--im-heading)] mt-0.5">{result.totalAutoKeywordsEligible.toLocaleString()}</div>
              </div>
              {result.customKeywords.length > 0 && (
                <>
                  <div className="p-3.5 rounded-xl bg-[var(--im-accent-tint)] border border-[#bbf7d0]">
                    <div className="text-xs text-[#15803d] font-medium">Target Entered</div>
                    <div className="text-xl font-bold text-[#14532d] mt-0.5">{result.customKeywords.length}</div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[var(--im-accent-tint)] border border-[#bbf7d0]">
                    <div className="text-xs text-[#15803d] font-medium">Target Found</div>
                    <div className="text-xl font-bold text-[#14532d] mt-0.5">{targetFoundCount}</div>
                  </div>
                </>
              )}
            </div>

            {/* Metadata details */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--im-text-muted)] pt-2 border-t border-[var(--im-border)]">
              {result.mode === 'url' && result.requestedUrl && (
                <div>
                  Analysed URL: <span className="font-semibold text-[var(--im-heading)] break-all">{result.requestedUrl}</span>
                </div>
              )}
              {result.mode === 'url' && result.finalUrl && result.finalUrl !== result.requestedUrl && (
                <div>
                  Final URL: <span className="font-semibold text-[var(--im-heading)] break-all">{result.finalUrl}</span>
                </div>
              )}
              {result.httpStatus && (
                <div>
                  HTTP Status: <span className="font-semibold text-[var(--im-heading)]">{result.httpStatus}</span>
                </div>
              )}
              <div>
                Extraction Method: <span className="font-semibold text-[var(--im-heading)]">{formatExtractionMethod(result.extractionMethod)}</span>
              </div>
              <div>
                Content Scope:{' '}
                <span className="font-semibold text-[var(--im-heading)]">
                  {result.mode === 'text' ? 'Pasted Content' : result.contentScope === 'main' ? 'Main Content Only' : 'Full Visible Page Content'}
                </span>
              </div>
              <div>
                Stop Words: <span className="font-semibold text-[var(--im-heading)]">{result.stopWordsExcluded ? 'Excluded (Auto)' : 'Included'}</span>
              </div>
              <div>
                Completed in: <span className="font-semibold text-[var(--im-heading)]">{result.processingDurationMs} ms</span>
              </div>
            </div>
          </section>

          {/* Target Keyword Analysis + Add More Target Keywords */}
          <section className="bg-[var(--im-surface)] border border-[var(--im-border)] rounded-2xl p-5 sm:p-7 shadow-[var(--im-shadow-sm)] space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-[var(--im-heading)]">Target Keyword Analysis</h2>
                <p className="text-xs text-[var(--im-text-muted)] mt-0.5">
                  Add or remove target keywords without re-fetching the webpage.
                </p>
              </div>
              {result.customKeywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const text = result.customKeywords
                        .map((k, i) => `${i + 1}\t${k.keyword}\t${k.wordCount}\t${k.frequency}\t${k.density.toFixed(2)}%\t${k.status}`)
                        .join('\n');
                      navigator.clipboard.writeText(`Sr. No.\tTarget Keyword\tWord Count\tFrequency\tDensity\tStatus\n${text}`);
                      showCopied('custom');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                  >
                    {copiedFeedback === 'custom' ? 'Copied!' : 'Copy Table'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadTextFile(
                        generateTargetKeywordsCsv(result, result.customKeywords),
                        'keyword-density-target-keywords.csv',
                        'text/csv;charset=utf-8;'
                      )
                    }
                    className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                  >
                    Download CSV
                  </button>
                </div>
              )}
            </div>

            {/* Add More Target Keywords */}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={additionalKeywordsInput}
                onChange={(e) => setAdditionalKeywordsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMoreKeywords();
                  }
                }}
                placeholder="Add target keyword(s) (comma-separated, e.g. plots in Goa, villa)"
                className="flex-1 px-3.5 py-2 rounded-lg bg-[var(--im-bg-soft)] border border-[var(--im-border)] text-sm text-[var(--im-text)] focus:border-[var(--im-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddMoreKeywords}
                className="px-4 py-2 rounded-lg bg-[var(--im-secondary)] text-white text-xs sm:text-sm font-semibold hover:opacity-90 cursor-pointer shrink-0"
              >
                Add Keywords
              </button>
            </div>

            {result.customKeywords.length > 0 && (
              <>
                {/* Search / Filter / Sort Controls */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="text"
                    value={customSearch}
                    onChange={(e) => setCustomSearch(e.target.value)}
                    placeholder="Filter target keywords..."
                    className="px-3 py-1.5 rounded-lg bg-[var(--im-bg-soft)] border border-[var(--im-border)] text-xs sm:text-sm flex-1 min-w-[180px]"
                  />
                  <select
                    aria-label="Filter target keywords by status"
                    value={customFilter}
                    onChange={(e) => setCustomFilter(e.target.value as typeof customFilter)}
                    className="px-3 py-1.5 rounded-lg bg-[var(--im-bg-soft)] border border-[var(--im-border)] text-xs sm:text-sm"
                  >
                    <option value="all">All ({result.customKeywords.length})</option>
                    <option value="found">Found ({targetFoundCount})</option>
                    <option value="not-found">Not Found ({result.customKeywords.length - targetFoundCount})</option>
                  </select>
                  <select
                    aria-label="Sort target keywords"
                    value={customSort}
                    onChange={(e) => setCustomSort(e.target.value as typeof customSort)}
                    className="px-3 py-1.5 rounded-lg bg-[var(--im-bg-soft)] border border-[var(--im-border)] text-xs sm:text-sm"
                  >
                    <option value="order">Original Order</option>
                    <option value="freq-desc">Frequency (High to Low)</option>
                    <option value="freq-asc">Frequency (Low to High)</option>
                    <option value="density-desc">Density (High to Low)</option>
                    <option value="alpha-asc">Alphabetical (A-Z)</option>
                  </select>
                </div>

                {/* Table */}
                <div className="overflow-x-auto border border-[var(--im-border)] rounded-xl">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead className="bg-[var(--im-bg-soft)] text-[var(--im-heading)] border-b border-[var(--im-border)]">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Sr. No.</th>
                        <th className="py-2.5 px-3 font-semibold">Target Keyword</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Word Count</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Frequency</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Density (%)</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--im-border)]">
                      {filteredCustomKeywords.map((kw, idx) => (
                        <tr key={kw.keyword} className="hover:bg-[var(--im-bg-soft)]/60">
                          <td className="py-2.5 px-3 text-[var(--im-text-muted)]">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-semibold text-[var(--im-heading)]">{kw.keyword}</td>
                          <td className="py-2.5 px-3 text-right">{kw.wordCount}</td>
                          <td className="py-2.5 px-3 text-right font-semibold">{kw.frequency}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{kw.density.toFixed(2)}%</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                                kw.status === 'Found'
                                  ? 'bg-[#dcfce7] text-[#15803d]'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {kw.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right space-x-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setContextTarget({ keyword: kw.keyword, frequency: kw.frequency, density: kw.density })}
                              className="text-xs font-semibold text-[var(--im-primary-deep)] hover:underline cursor-pointer"
                            >
                              View Context
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTargetKeyword(kw.keyword)}
                              aria-label={`Remove ${kw.keyword}`}
                              className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Keyword Distribution across Quarters */}
                <div className="pt-2 space-y-2.5">
                  <h3 className="text-sm font-bold text-[var(--im-heading)]">Keyword Distribution Across Content</h3>
                  <div className="overflow-x-auto border border-[var(--im-border)] rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-[var(--im-bg-soft)] border-b border-[var(--im-border)] text-[var(--im-heading)]">
                        <tr>
                          <th className="py-2 px-3 font-semibold">Target Keyword</th>
                          <th className="py-2 px-3 font-semibold text-right">First 25%</th>
                          <th className="py-2 px-3 font-semibold text-right">Second 25%</th>
                          <th className="py-2 px-3 font-semibold text-right">Third 25%</th>
                          <th className="py-2 px-3 font-semibold text-right">Final 25%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--im-border)]">
                        {filteredCustomKeywords.map((kw) => (
                          <tr key={`dist-${kw.keyword}`}>
                            <td className="py-2 px-3 font-medium text-[var(--im-heading)]">{kw.keyword}</td>
                            {kw.distribution.map((cnt, qIdx) => (
                              <td key={qIdx} className="py-2 px-3 text-right font-mono">
                                {cnt}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* Keyword Placement Analysis (URL mode only) */}
          {result.mode === 'url' && result.metadataSignals && (
            <section className="bg-[var(--im-surface)] border border-[var(--im-border)] rounded-2xl p-5 sm:p-7 shadow-[var(--im-shadow-sm)] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-[var(--im-heading)]">Keyword Placement Analysis</h2>
                  <p className="text-xs text-[var(--im-text-muted)] mt-0.5">
                    Occurrence counts across HTML metadata, headings, body scope, anchors, image alt attributes, and URL path.
                  </p>
                </div>
                {activePlacementRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadTextFile(
                        generatePlacementCsv(activePlacementRows),
                        'keyword-density-placement.csv',
                        'text/csv;charset=utf-8;'
                      )
                    }
                    className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                  >
                    Download Placement CSV
                  </button>
                )}
              </div>

              {result.customKeywords.length === 0 && (
                <div className="p-3.5 rounded-xl bg-[var(--im-bg-soft)] border border-[var(--im-border)] space-y-2">
                  <p className="text-xs text-[var(--im-text-muted)]">
                    Select automatically detected keywords below to inspect their webpage placement:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.autoKeywords[1].slice(0, 10).map((item) => {
                      const active = selectedAutoForPlacement.includes(item.keyword);
                      return (
                        <button
                          key={item.keyword}
                          type="button"
                          onClick={() =>
                            setSelectedAutoForPlacement((prev) =>
                              active ? prev.filter((k) => k !== item.keyword) : [...prev, item.keyword]
                            )
                          }
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer transition-colors ${
                            active
                              ? 'bg-[var(--im-primary)] text-white border-[var(--im-primary)]'
                              : 'bg-[var(--im-surface)] text-[var(--im-text)] border-[var(--im-border)] hover:border-[var(--im-primary-deep)]'
                          }`}
                        >
                          {item.keyword} ({item.frequency})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activePlacementRows.length > 0 && (
                <div className="overflow-x-auto border border-[var(--im-border)] rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-[var(--im-bg-soft)] border-b border-[var(--im-border)] text-[var(--im-heading)]">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Keyword</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">Title</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">Meta Desc</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">H1</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">H2</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">H3</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">H4–H6</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">Body</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">Anchors</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">Alt Text</th>
                        <th className="py-2.5 px-2.5 font-semibold text-right">URL Path</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--im-border)]">
                      {activePlacementRows.map((p) => {
                        const cell = (val: number | null) =>
                          val === null ? (
                            <span className="text-[var(--im-text-muted)]" title="Element absent">
                              N/A
                            </span>
                          ) : (
                            <span className={val > 0 ? 'font-bold text-[#15803d]' : 'text-[var(--im-text-muted)]'}>
                              {val}
                            </span>
                          );
                        return (
                          <tr key={`place-${p.keyword}`} className="hover:bg-[var(--im-bg-soft)]/60">
                            <td className="py-2.5 px-3 font-semibold text-[var(--im-heading)]">{p.keyword}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.title)}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.metaDescription)}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.h1)}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.h2)}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.h3)}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.h4To6)}</td>
                            <td className="py-2.5 px-2.5 text-right font-semibold">{p.body}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.anchors)}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.altText)}</td>
                            <td className="py-2.5 px-2.5 text-right">{cell(p.urlPath)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Automatically Detected Keywords */}
          <section className="bg-[var(--im-surface)] border border-[var(--im-border)] rounded-2xl p-5 sm:p-7 shadow-[var(--im-shadow-sm)] space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-[var(--im-heading)]">Automatically Detected Keywords</h2>
                <p className="text-xs text-[var(--im-text-muted)] mt-0.5">
                  Frequently occurring words and phrases from the analysed content.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const text = filteredAutoKeywords
                      .map((k, i) => `${i + 1}\t${k.keyword}\t${k.frequency}\t${k.density.toFixed(2)}%`)
                      .join('\n');
                    navigator.clipboard.writeText(`Rank\tKeyword\tFrequency\tDensity\n${text}`);
                    showCopied('auto');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                >
                  {copiedFeedback === 'auto' ? 'Copied!' : 'Copy Results'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(
                      generateAutoKeywordsCsv(result, activeNgramTab),
                      `keyword-density-automatic-${activeNgramTab}w.csv`,
                      'text/csv;charset=utf-8;'
                    )
                  }
                  className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                >
                  CSV ({activeNgramTab} Word{activeNgramTab > 1 ? 's' : ''})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(
                      generateAutoKeywordsCsv(result, 'all'),
                      'keyword-density-automatic-keywords.csv',
                      'text/csv;charset=utf-8;'
                    )
                  }
                  className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                >
                  CSV (All Phrases)
                </button>
              </div>
            </div>

            {/* N-gram Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-[var(--im-border)] pb-3">
              {([1, 2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { setActiveNgramTab(n); setAutoPage(1); }}
                  className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    activeNgramTab === n
                      ? 'bg-[var(--im-primary)] text-white shadow-xs'
                      : 'bg-[var(--im-bg-soft)] text-[var(--im-text)] border border-[var(--im-border)] hover:border-[var(--im-primary-deep)]'
                  }`}
                >
                  {n} {n === 1 ? 'Word' : 'Words'} ({result.autoKeywords[n].length})
                </button>
              ))}
            </div>

            {/* Filters & Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="text"
                value={autoSearch}
                onChange={(e) => { setAutoSearch(e.target.value); setAutoPage(1); }}
                placeholder="Search detected keywords..."
                className="px-3 py-1.5 rounded-lg bg-[var(--im-bg-soft)] border border-[var(--im-border)] text-xs sm:text-sm flex-1 min-w-[180px]"
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--im-text-muted)]">
                Min Freq:
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={minFrequency}
                  onChange={(e) => handleMinFrequencyChange(Number(e.target.value))}
                  className="w-16 px-2 py-1.5 rounded-lg bg-[var(--im-bg-soft)] border border-[var(--im-border)] text-xs text-[var(--im-heading)]"
                />
              </label>
              <select
                aria-label="Sort automatic keywords"
                value={autoSort}
                onChange={(e) => setAutoSort(e.target.value as typeof autoSort)}
                className="px-3 py-1.5 rounded-lg bg-[var(--im-bg-soft)] border border-[var(--im-border)] text-xs sm:text-sm"
              >
                <option value="freq-desc">Frequency (High to Low)</option>
                <option value="freq-asc">Frequency (Low to High)</option>
                <option value="density-desc">Density (High to Low)</option>
                <option value="alpha-asc">Alphabetical (A-Z)</option>
              </select>
              <select
                aria-label="Rows per page"
                value={rowsPerPage}
                onChange={(e) => { setRowsPerPage(Number(e.target.value)); setAutoPage(1); }}
                className="px-3 py-1.5 rounded-lg bg-[var(--im-bg-soft)] border border-[var(--im-border)] text-xs sm:text-sm"
              >
                <option value={25}>25 rows</option>
                <option value={50}>50 rows</option>
                <option value={100}>100 rows</option>
              </select>
            </div>

            {/* Auto Keywords Table */}
            {paginatedAutoKeywords.length === 0 ? (
              <div className="text-center py-8 text-sm text-[var(--im-text-muted)] border border-[var(--im-border)] rounded-xl">
                No {activeNgramTab}-word phrases met the current filter criteria (minimum frequency: {minFrequency}).
              </div>
            ) : (
              <div className="overflow-x-auto border border-[var(--im-border)] rounded-xl">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead className="bg-[var(--im-bg-soft)] text-[var(--im-heading)] border-b border-[var(--im-border)]">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Rank</th>
                      <th className="py-2.5 px-3 font-semibold">Keyword</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Frequency</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Density (%)</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--im-border)]">
                    {paginatedAutoKeywords.map((item, idx) => (
                      <tr key={item.keyword} className="hover:bg-[var(--im-bg-soft)]/60">
                        <td className="py-2.5 px-3 text-[var(--im-text-muted)]">
                          {(autoPage - 1) * rowsPerPage + idx + 1}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[var(--im-heading)]">{item.keyword}</td>
                        <td className="py-2.5 px-3 text-right font-semibold">{item.frequency}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{item.density.toFixed(2)}%</td>
                        <td className="py-2.5 px-3 text-right space-x-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setContextTarget({ keyword: item.keyword, frequency: item.frequency, density: item.density })}
                            className="text-xs font-semibold text-[var(--im-primary-deep)] hover:underline cursor-pointer"
                          >
                            View Context
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddAutoKeywordToTargets(item.keyword)}
                            className="text-xs font-semibold text-[var(--im-secondary)] hover:underline cursor-pointer"
                          >
                            + Add to Target Keywords
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalAutoPages > 1 && (
              <div className="flex items-center justify-between text-xs text-[var(--im-text-muted)]">
                <span>
                  Page {autoPage} of {totalAutoPages} ({filteredAutoKeywords.length} results)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={autoPage <= 1}
                    onClick={() => setAutoPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] disabled:opacity-50 cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={autoPage >= totalAutoPages}
                    onClick={() => setAutoPage((p) => Math.min(totalAutoPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] disabled:opacity-50 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Keyword Density Insights & SEO Guidance */}
          <section className="bg-[var(--im-surface)] border border-[var(--im-border)] rounded-2xl p-5 sm:p-7 shadow-[var(--im-shadow-sm)] space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-[var(--im-heading)]">Keyword Density Insights &amp; SEO Guidance</h2>
            {insights.length > 0 && (
              <ul className="space-y-1.5 text-xs sm:text-sm text-[var(--im-text)]">
                {insights.map((ins, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--im-primary-deep)] mt-2 shrink-0" />
                    <span>{ins}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-[var(--im-text-muted)] bg-[var(--im-bg-soft)] border border-[var(--im-border)] rounded-xl p-3.5 leading-relaxed">
              Keyword density measures how frequently a word or phrase appears in content. Google does not prescribe an ideal keyword density percentage. Use these results to review keyword usage, relevance and readability rather than targeting a fixed percentage.
            </p>
          </section>

          {/* View Analysed Content (Collapsible) */}
          <section className="bg-[var(--im-surface)] border border-[var(--im-border)] rounded-2xl p-5 sm:p-7 shadow-[var(--im-shadow-sm)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--im-heading)]">View Analysed Content</h2>
                <p className="text-xs text-[var(--im-text-muted)]">
                  {result.totalWords.toLocaleString()} words &middot; {result.totalCharacters.toLocaleString()} characters &middot;{' '}
                  {formatExtractionMethod(result.extractionMethod)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(result.extractedText);
                    showCopied('content');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                >
                  {copiedFeedback === 'content' ? 'Copied!' : 'Copy Content'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(result.extractedText, 'analysed-content.txt', 'text/plain;charset=utf-8;')
                  }
                  className="px-3 py-1.5 rounded-lg border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                >
                  Download TXT
                </button>
                <button
                  type="button"
                  onClick={() => setShowContentPreview((v) => !v)}
                  className="px-3 py-1.5 rounded-lg bg-[var(--im-secondary)] text-white text-xs font-semibold cursor-pointer"
                >
                  {showContentPreview ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>

            {showContentPreview && (
              <div className="space-y-2.5 pt-2">
                <pre className="whitespace-pre-wrap break-words text-xs sm:text-sm bg-[var(--im-bg-soft)] border border-[var(--im-border)] rounded-xl p-4 max-h-96 overflow-y-auto text-[var(--im-text)]">
                  {result.extractedText.slice(0, previewCharLimit)}
                </pre>
                {result.extractedText.length > previewCharLimit && (
                  <button
                    type="button"
                    onClick={() => setPreviewCharLimit((c) => c + 10000)}
                    className="px-4 py-1.5 rounded-lg border border-[var(--im-border)] text-xs font-semibold text-[var(--im-heading)] hover:border-[var(--im-primary-deep)] cursor-pointer"
                  >
                    Show More ({(result.extractedText.length - previewCharLimit).toLocaleString()} characters remaining)
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Keyword Context Modal */}
      <ContextModal
        key={contextTarget?.keyword ?? 'closed'}
        keyword={contextTarget?.keyword ?? null}
        frequency={contextTarget?.frequency ?? 0}
        density={contextTarget?.density ?? 0}
        segments={result?.segments ?? []}
        onClose={() => setContextTarget(null)}
      />
    </div>
  );
}
