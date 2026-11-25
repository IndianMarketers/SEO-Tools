'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  buildHighlightedParts,
  findKeywordContextMatches,
} from '@/lib/seo/keyword-density/contextFinder';
import type { ContentSegment } from '@/lib/seo/keyword-density/types';

interface ContextModalProps {
  keyword: string | null;
  frequency: number;
  density: number;
  segments: ContentSegment[];
  onClose: () => void;
}

const MATCHES_PER_PAGE = 25;

export default function ContextModal({
  keyword,
  frequency,
  density,
  segments,
  onClose,
}: ContextModalProps) {
  const [visibleCount, setVisibleCount] = useState(MATCHES_PER_PAGE);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!keyword) return;
    closeBtnRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keyword, onClose]);

  if (!keyword) return null;

  const matches = findKeywordContextMatches(segments, keyword);
  const visibleMatches = matches.slice(0, visibleCount);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-[var(--im-surface)] border border-[var(--im-border)] rounded-2xl shadow-[var(--im-shadow-lg)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--im-border)] flex items-start justify-between gap-4 bg-[var(--im-bg-soft)]">
          <div>
            <h3 id="context-modal-title" className="text-base sm:text-lg font-bold text-[var(--im-heading)]">
              Keyword Context: <span className="text-[var(--im-primary-deep)]">&quot;{keyword}&quot;</span>
            </h3>
            <p className="text-xs sm:text-sm text-[var(--im-text-muted)] mt-0.5">
              Total Frequency: <strong className="text-[var(--im-heading)]">{frequency}</strong> &middot; Density:{' '}
              <strong className="text-[var(--im-heading)]">{density.toFixed(2)}%</strong> &middot; Matching Segments:{' '}
              <strong className="text-[var(--im-heading)]">{matches.length}</strong>
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close context modal"
            className="p-1.5 rounded-lg text-[var(--im-text-muted)] hover:text-[var(--im-heading)] hover:bg-[var(--im-border)]/40 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {matches.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--im-text-muted)]">
              No occurrences found in the analysed content.
            </div>
          ) : (
            <>
              {visibleMatches.map((m, idx) => {
                const parts = buildHighlightedParts(m.text, keyword);
                return (
                  <div
                    key={`${m.segmentIndex}-${idx}`}
                    className="p-3.5 rounded-xl border border-[var(--im-border)] bg-[var(--im-bg-soft)] text-sm leading-relaxed text-[var(--im-text)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 text-xs text-[var(--im-text-muted)]">
                      <span>
                        {m.sectionHeading ? (
                          <>
                            Section: <strong className="text-[var(--im-heading)]">{m.sectionHeading}</strong>
                          </>
                        ) : (
                          `Segment #${m.segmentIndex + 1}`
                        )}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[var(--im-accent-tint)] text-[#15803d] font-semibold">
                        {m.matchCount} {m.matchCount === 1 ? 'match' : 'matches'}
                      </span>
                    </div>
                    <p>
                      {parts.map((part, pIdx) =>
                        part.isMatch ? (
                          <mark
                            key={pIdx}
                            className="bg-[#bbf7d0] text-[#14532d] font-semibold px-1 rounded-xs"
                          >
                            {part.text}
                          </mark>
                        ) : (
                          <React.Fragment key={pIdx}>{part.text}</React.Fragment>
                        )
                      )}
                    </p>
                  </div>
                );
              })}

              {matches.length > visibleCount && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + MATCHES_PER_PAGE)}
                    className="px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg border border-[var(--im-border)] bg-[var(--im-surface)] hover:border-[var(--im-primary-deep)] text-[var(--im-heading)] transition-colors cursor-pointer"
                  >
                    Load More ({matches.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
