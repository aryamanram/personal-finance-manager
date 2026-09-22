'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import {
  describePeriod, stepPeriod,
  type PeriodOption, type PeriodScope,
} from '@/lib/periods';

/**
 * Period selector. It IS the page heading — the timeframe is the only thing
 * the title needs to say, so no sentence wraps around it.
 *
 *   ‹   August 2026   ›
 *   All time › 2026 · 2025 · 2024
 *             Sep · Aug · Jul …
 *             1st – 15th · 16th – 31st
 *
 * Two mechanisms, deliberately independent:
 *
 * STEP (‹ ›, or ← →) walks the ledger at the current zoom, FLAT. Stepping
 * back twice from the first half of September reaches the second half of
 * August — the arrows mean "the period before this one", and a pay period
 * before the 1st belongs to last month whatever the tree says about
 * parentage. Only the true ends of the ledger disable an arrow.
 *
 * DRILL (the rows beneath) reveals one level at a time. You see All time and
 * the years; pick a year and its months appear; pick a month and its halves
 * appear. Nothing deeper is on screen until it is relevant, so the control
 * never exceeds four rows however many years accumulate.
 */
export function PeriodPicker({
  options,
  active,
  align = 'start',
}: {
  options: PeriodOption[];
  active: string;
  align?: 'start' | 'end';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const byKey = new Map(options.map((o) => [o.key, o]));
  const current = byKey.get(active) ?? options[0]!;

  // Held in a ref so the keyboard listener never closes over a stale router.
  const go = useRef<(key: string) => void>(() => {});
  go.current = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('period', key);
    router.push(`${pathname}?${next.toString()}`);
  };

  const older = stepPeriod(options, current, -1);
  const newer = stepPeriod(options, current, 1);

  // ← / → do exactly what the arrows do. Ignored while typing, so the
  // register's search box and rename field keep their own cursor movement.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;

      const to = e.key === 'ArrowLeft' ? older : newer;
      if (!to) return;
      e.preventDefault();
      go.current(to.key);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [older, newer]);

  // The trail from the root to where we are, which decides how many drill
  // rows to show and which pill in each is lit.
  const trail: PeriodOption[] = [];
  for (let p: PeriodOption | undefined = current; p; p = p.parent ? byKey.get(p.parent) : undefined) {
    trail.unshift(p);
  }
  const onTrail = new Set(trail.map((p) => p.key));

  const years = options.filter((o) => o.scope === 'year');
  const year = trail.find((p) => p.scope === 'year');
  const month = trail.find((p) => p.scope === 'month');

  const deeperRows: { scope: PeriodScope; items: PeriodOption[] }[] = [];
  if (year) {
    deeperRows.push({ scope: 'month', items: options.filter((o) => o.parent === year.key) });
  }
  if (month) {
    deeperRows.push({ scope: 'half', items: options.filter((o) => o.parent === month.key) });
  }

  const edge = align === 'end' ? 'items-end' : 'items-start';

  return (
    <div className={clsx('flex flex-col gap-3', edge)}>
      <div className="flex items-center gap-1">
        <Arrow dir="older" onClick={() => older && go.current(older.key)} disabled={!older} />
        {/* The heading. No sentence around it: the timeframe is the title. */}
        <h1 className="min-w-[13ch] px-1 text-center text-2xl font-semibold tracking-tight text-paper">
          {describePeriod(current)}
        </h1>
        <Arrow dir="newer" onClick={() => newer && go.current(newer.key)} disabled={!newer} />
      </div>

      <div className={clsx('flex flex-col gap-1.5', edge)}>
        <div className="flex flex-wrap items-center gap-1">
          <Pill on={current.key === 'all'} onClick={() => go.current('all')}>
            All time
          </Pill>
          {years.length > 0 && (
            <span className="px-0.5 text-xs text-ink-500" aria-hidden>›</span>
          )}
          {years.map((o) => (
            <Pill
              key={o.key}
              on={o.key === current.key}
              dim={!onTrail.has(o.key)}
              onClick={() => go.current(o.key)}
            >
              {o.label}
            </Pill>
          ))}
        </div>

        {deeperRows.map((row) => (
          <div key={row.scope} className="flex flex-wrap items-center gap-1">
            {row.items.map((o) => (
              <Pill
                key={o.key}
                on={o.key === current.key}
                dim={!onTrail.has(o.key)}
                onClick={() => go.current(o.key)}
              >
                {row.scope === 'month' ? o.label.replace(/\s+\d{2}$/, '') : o.label}
              </Pill>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({
  on,
  dim,
  onClick,
  children,
}: {
  on: boolean;
  dim?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={clsx(
        'figure rounded-sm border px-2 py-0.5 text-xs transition-colors',
        on
          ? 'border-ink-500 bg-ink-700 text-paper'
          : dim
            ? 'border-transparent text-paper-faint hover:border-ink-600 hover:text-paper-dim'
            : 'border-ink-700 text-paper-dim hover:border-ink-500 hover:text-paper',
      )}
    >
      {children}
    </button>
  );
}

function Arrow({
  dir,
  onClick,
  disabled,
}: {
  dir: 'older' | 'newer';
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'older' ? 'Previous period' : 'Next period'}
      title={dir === 'older' ? 'Previous period (←)' : 'Next period (→)'}
      className={clsx(
        'rounded-sm px-2 py-1 text-xl leading-none transition-colors',
        disabled
          ? 'cursor-default text-ink-700'
          : 'text-paper-faint hover:bg-ink-800 hover:text-paper',
      )}
    >
      {dir === 'older' ? '‹' : '›'}
    </button>
  );
}
