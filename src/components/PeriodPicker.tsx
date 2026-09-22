'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import type { PeriodOption } from '@/lib/periods';

/**
 * Period selector for the cashflow and flow views.
 *
 * A flat <select> of the whole hierarchy grows by 26 entries a year — 78
 * already, on a two-year ledger — and scrolling a list that long to reach one
 * fortnight is not choosing, it is hunting. So the control shows ONE LEVEL at
 * a time: a breadcrumb of where you are, and the siblings available at the
 * depth you are standing at.
 *
 *   All time · 2026 · Sep      ← the trail, each step clickable
 *   [ Sep ][ Aug ][ Jul ] …    ← this level's siblings
 *   1st – 15th | 16th – 30th   ← one level deeper, when it exists
 *
 * The number of controls is therefore constant: twelve months in a year,
 * twelve-ish years in a lifetime, two halves in a month. Nothing grows without
 * bound, and the ledger's shape is legible instead of being a scrollbar.
 *
 * The period lives in the URL, so a view is shareable and survives a reload.
 */
export function PeriodPicker({
  options,
  active,
  align = 'end',
}: {
  options: PeriodOption[];
  active: string;
  /**
   * Which edge the rows hang from. The flow page puts the picker opposite its
   * heading, so it reads inward from the right; the dashboard stacks it under
   * the heading, where a right edge would leave a ragged gap.
   */
  align?: 'start' | 'end';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const byKey = new Map(options.map((o) => [o.key, o]));
  const current = byKey.get(active) ?? options[0]!;

  /** Navigates to the current page with the selected period in its query. */
  function go(key: string) {
    const next = new URLSearchParams(params.toString());
    next.set('period', key);
    router.push(`${pathname}?${next.toString()}`);
  }

  // Walk up to the root, so the trail is always complete however deep we are.
  const trail: PeriodOption[] = [];
  for (let p: PeriodOption | undefined = current; p; p = p.parent ? byKey.get(p.parent) : undefined) {
    trail.unshift(p);
  }

  // The siblings at this depth are the periods sharing our parent. At the root
  // there are none — "All time" is alone, and the trail already shows it — so
  // the first row becomes the years, which would otherwise be the second.
  const siblings = current.parent
    ? options.filter((o) => o.parent === current.parent)
    : [];

  // One level deeper, if this period has children. Months have halves; the
  // last level has none, and the row simply does not render.
  //
  // Skipped when it would repeat the sibling row: at the root, siblings is
  // empty and the years ARE the children, so rendering both drew every year
  // twice.
  const children = options.filter((o) => o.parent === current.key);
  const rows = siblings.length > 0 ? [siblings, children] : [children];

  return (
    <div
      className={clsx(
        'flex flex-col gap-2',
        align === 'end' ? 'items-start sm:items-end' : 'items-start',
      )}
    >
      <nav aria-label="Period" className="flex flex-wrap items-center gap-1 text-xs">
        {trail.map((p, i) => (
          <span key={p.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-ink-500" aria-hidden>·</span>}
            {p.key === current.key ? (
              <span className="text-paper" aria-current="true">{crumb(p)}</span>
            ) : (
              <button
                onClick={() => go(p.key)}
                className="text-paper-faint transition-colors hover:text-paper"
              >
                {crumb(p)}
              </button>
            )}
          </span>
        ))}
      </nav>

      {/* This depth, then one level down. Two rows at most, each bounded:
          twelve months in a year, two halves in a month. */}
      {rows.map((row, depth) =>
        row.length === 0 ? null : (
          <div key={depth} className="flex flex-wrap items-center gap-1">
            {row.map((o) => (
              <Chip
                key={o.key}
                on={o.key === current.key}
                quiet={depth > 0}
                onClick={() => go(o.key)}
              >
                {chipLabel(o)}
              </Chip>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function Chip({
  on,
  quiet,
  onClick,
  children,
}: {
  on: boolean;
  quiet?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={clsx(
        'figure rounded-sm border px-2 py-1 text-xs transition-colors',
        on
          ? 'border-ink-500 bg-ink-700 text-paper'
          : quiet
            ? 'border-transparent text-paper-faint hover:border-ink-600 hover:text-paper-dim'
            : 'border-ink-700 text-paper-dim hover:border-ink-500 hover:text-paper',
      )}
    >
      {children}
    </button>
  );
}

/** Breadcrumb text: terse, because the trail supplies the context. */
function crumb(p: PeriodOption): string {
  if (p.scope === 'all') return 'All time';
  if (p.scope === 'month') return stripYear(p.label);
  return p.label;
}

/**
 * Chip text. A month chip drops its year — the trail above already says 2026,
 * and "Sep 26" beside "Aug 26" repeats a digit pair eleven times for nothing.
 */
function chipLabel(p: PeriodOption): string {
  return p.scope === 'month' ? stripYear(p.label) : p.label;
}

/** "Sep 26" → "Sep". formatMonthShort appends a two-digit year. */
function stripYear(label: string): string {
  return label.replace(/\s+\d{2}$/, '');
}
