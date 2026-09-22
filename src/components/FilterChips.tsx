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

  /** Toggles one flag, dropping it from the URL when switched off. */
  function href(key: string, on: boolean): string {
    const next = new URLSearchParams(params.toString());
    if (on) next.delete(key);
    else next.set(key, '1');
    // The two review filters are alternatives, not a conjunction: holding both
    // asks for rows that are simultaneously guessed and unguessed.
    if (!on && key === 'review') next.delete('uncategorized');
    if (!on && key === 'uncategorized') next.delete('review');
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Chip href={href('review', active.review)} on={active.review} disabled={needsReview === 0}>
        Needs review · <span className="figure">{needsReview}</span>
      </Chip>
      <Chip
        href={href('uncategorized', active.uncategorized)}
        on={active.uncategorized}
        disabled={uncategorized === 0}
      >
        Uncategorized · <span className="figure">{uncategorized}</span>
      </Chip>
      <Chip href={href('voided', active.voided)} on={active.voided}>
        Show voided
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

function Chip({
  href,
  on,
  disabled,
  children,
}: {
  href: string;
  on: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  // A zero-count backlog is worth showing (it is good news) but not worth
  // clicking — it would filter to an empty table.
  if (disabled && !on) {
    return (
      <span className="rounded-sm border border-ink-700 px-3 py-1.5 text-paper-faint opacity-60">
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-pressed={on}
      className={clsx(
        'rounded-sm border px-3 py-1.5 transition-colors',
        on
          ? 'border-out bg-out/10 text-out'
          : 'border-ink-600 text-paper-dim hover:border-ink-500 hover:text-paper',
      )}
    >
      {children}
    </Link>
  );
}
