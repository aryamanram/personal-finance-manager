'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';

/**
 * The register's two review backlogs, as toggles (wireframe 45:3).
 *
 * Links rather than buttons: the filter belongs in the URL, so a filtered
 * register is shareable and survives a reload — the same reasoning as the
 * period picker.
 */
export function FilterChips({
  needsReview,
  uncategorized,
  active,
  hasFilters,
}: {
  needsReview: number;
  uncategorized: number;
  active: { review: boolean; uncategorized: boolean; voided: boolean };
  hasFilters: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (key: string, on: boolean) => toggleHref(pathname, params, key, on);
  const clearBacklog = () => clearBacklogHref(pathname, params);

  // A backlog chip is a to-do, so an empty one is not worth a control. They
  // disappear at zero rather than sitting greyed out forever — which is the
  // steady state once a month has been confirmed, and the point at which the
  // register should look finished rather than merely quiet.
  const showReview = needsReview > 0;
  const showUncategorized = uncategorized > 0;
  const filtering = active.review || active.uncategorized;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {/* "All" is what makes the selected state legible: with only togglable
          chips, nothing-selected and everything-selected look identical. */}
      {(showReview || showUncategorized) && (
        <Chip href={clearBacklog()} on={!filtering}>
          All
        </Chip>
      )}

      {showReview && (
        <Chip href={href('review', active.review)} on={active.review}>
          Needs review · <span className="figure">{needsReview}</span>
        </Chip>
      )}

      {showUncategorized && (
        <Chip href={href('uncategorized', active.uncategorized)} on={active.uncategorized}>
          Uncategorized · <span className="figure">{uncategorized}</span>
        </Chip>
      )}

      {!showReview && !showUncategorized && (
        <span className="text-paper-faint">Everything is categorised.</span>
      )}

      <Chip href={href('voided', active.voided)} on={active.voided} quiet>
        Voided
      </Chip>

      {hasFilters && (
        <Link
          href={pathname}
          className="ml-1 px-2 py-1.5 text-paper-faint transition-colors hover:text-paper"
        >
          Reset
        </Link>
      )}
    </div>
  );
}

/** The two backlog filters. Alternatives, never held together. */
const BACKLOG_KEYS = ['review', 'uncategorized'] as const;

function withQuery(pathname: string, next: URLSearchParams): string {
  const q = next.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/**
 * Toggles one filter, dropping it from the URL when switched off.
 *
 * Exported for tests: the URL is the whole behaviour of this component, and a
 * test that rebuilt these strings itself would pass while the real code was
 * wrong.
 */
export function toggleHref(
  pathname: string,
  params: URLSearchParams,
  key: string,
  on: boolean,
): string {
  const next = new URLSearchParams(params.toString());
  if (on) next.delete(key);
  else next.set(key, '1');
  // The two review filters are alternatives, not a conjunction: holding both
  // asks for rows that are simultaneously guessed and unguessed.
  if (!on && BACKLOG_KEYS.includes(key as (typeof BACKLOG_KEYS)[number])) {
    for (const other of BACKLOG_KEYS) if (other !== key) next.delete(other);
  }
  return withQuery(pathname, next);
}

/** Drops both backlog filters, keeping search, account and date range. */
export function clearBacklogHref(pathname: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params.toString());
  for (const key of BACKLOG_KEYS) next.delete(key);
  return withQuery(pathname, next);
}

function Chip({
  href,
  on,
  quiet,
  children,
}: {
  href: string;
  on: boolean;
  /** A view toggle rather than a backlog — recessive until switched on. */
  quiet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-pressed={on}
      className={clsx(
        'rounded-sm border px-3 py-1.5 transition-colors',
        on
          ? 'border-out bg-out/10 text-out'
          : quiet
            ? 'border-transparent text-paper-faint hover:border-ink-600 hover:text-paper-dim'
            : 'border-ink-600 text-paper-dim hover:border-ink-500 hover:text-paper',
      )}
    >
      {children}
    </Link>
  );
}
