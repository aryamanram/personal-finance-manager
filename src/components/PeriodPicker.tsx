'use client';

import { useEffect, useRef, useState } from 'react';
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
 *   ‹   September 2026, first half   ›
 *   All time › 2026 ▾ › Sep ▾ › 1st – 15th ▾
 *
 * Four segments, always four, whatever the ledger holds: each is a dropdown
 * over one level, so ten years of data is the same width as one. A segment
 * appears only once its parent is chosen — picking a year is what reveals the
 * month segment — so the row never presents a choice that has no meaning yet.
 *
 * STEP (‹ ›, or ← →) walks the ledger at the current zoom, FLAT. Stepping
 * back twice from the first half of September reaches the second half of
 * August: the arrows mean "the period before this one", and a pay period
 * before the 1st belongs to last month whatever the tree says about
 * parentage. Only the true ends of the ledger disable an arrow.
 *
 * Time runs LEFT TO RIGHT everywhere here — in the dropdowns, and in what the
 * arrows do. `›` and `→` always move forward in time and rightward on screen.
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
  const [open, setOpen] = useState<PeriodScope | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const byKey = new Map(options.map((o) => [o.key, o]));
  const current = byKey.get(active) ?? options[0]!;

  // Held in a ref so the keyboard listener never closes over a stale router.
  const go = useRef<(key: string) => void>(() => {});
  go.current = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('period', key);
    router.push(`${pathname}?${next.toString()}`);
    setOpen(null);
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

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const trail: PeriodOption[] = [];
  for (let p: PeriodOption | undefined = current; p; p = p.parent ? byKey.get(p.parent) : undefined) {
    trail.unshift(p);
  }
  const year = trail.find((p) => p.scope === 'year');
  const month = trail.find((p) => p.scope === 'month');

  /** Oldest first, so the menu reads the way time does. */
  const chrono = (ps: PeriodOption[]) =>
    [...ps].sort((a, b) => a.from.localeCompare(b.from));

  const segments: {
    scope: PeriodScope;
    label: string;
    chosen: boolean;
    items: PeriodOption[];
  }[] = [
    {
      scope: 'year',
      label: year ? year.label : 'Year',
      chosen: !!year,
      items: chrono(options.filter((o) => o.scope === 'year')),
    },
  ];
  if (year) {
    segments.push({
      scope: 'month',
      label: month ? month.label.replace(/\s+\d{2}$/, '') : 'Month',
      chosen: !!month,
      items: chrono(options.filter((o) => o.parent === year.key)),
    });
  }
  if (month) {
    const half = trail.find((p) => p.scope === 'half');
    segments.push({
      scope: 'half',
      label: half ? half.label : 'Pay period',
      chosen: !!half,
      items: chrono(options.filter((o) => o.parent === month.key)),
    });
  }

  const edge = align === 'end' ? 'items-end' : 'items-start';

  return (
    <div ref={root} className={clsx('flex flex-col gap-2', edge)}>
      <div className="flex items-center gap-1">
        <Arrow dir="older" onClick={() => older && go.current(older.key)} disabled={!older} />
        <h1 className="min-w-[13ch] px-1 text-center text-2xl font-semibold tracking-tight text-paper">
          {describePeriod(current)}
        </h1>
        <Arrow dir="newer" onClick={() => newer && go.current(newer.key)} disabled={!newer} />
      </div>

      {/* One line, four segments at most, fixed width however long the
          ledger runs. */}
      <div className="flex flex-wrap items-center gap-0.5 text-xs">
        <Segment
          label="All time"
          on={current.key === 'all'}
          onClick={() => go.current('all')}
        />

        {segments.map((seg) => (
          <span key={seg.scope} className="flex items-center gap-0.5">
            <span className="px-0.5 text-ink-500" aria-hidden>›</span>
            <div className="relative">
              <Segment
                label={seg.label}
                on={seg.chosen && current.scope === seg.scope}
                muted={!seg.chosen}
                caret
                expanded={open === seg.scope}
                onClick={() => setOpen((v) => (v === seg.scope ? null : seg.scope))}
              />
              {open === seg.scope && (
                <div
                  className={clsx(
                    'absolute top-full z-30 mt-1 max-h-[280px] w-max overflow-y-auto rounded-sm',
                    'border border-ink-600 bg-ink-800 p-1 shadow-2xl shadow-black/50',
                    // A 1fr grid track has no content floor, and an absolutely
                    // positioned box has no width to distribute, so grid-cols-3
                    // collapsed every month to 12px against 29px of text.
                    // Fixed columns wide enough for "Sep", laid out by w-max.
                    seg.scope === 'month'
                      ? 'grid grid-cols-[repeat(3,3.5rem)] gap-0.5'
                      : 'flex flex-col gap-0.5',
                    align === 'end' ? 'right-0' : 'left-0',
                  )}
                >
                  {seg.items.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => go.current(o.key)}
                      aria-pressed={o.key === current.key}
                      className={clsx(
                        'figure whitespace-nowrap rounded-sm px-2 py-1 text-xs transition-colors',
                        seg.scope === 'month' ? 'text-center' : 'text-left',
                        o.key === current.key
                          ? 'bg-ink-700 text-paper'
                          : 'text-paper-dim hover:bg-ink-700 hover:text-paper',
                      )}
                    >
                      {seg.scope === 'month' ? o.label.replace(/\s+\d{2}$/, '') : o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </span>
        ))}
      </div>
    </div>
  );
}

function Segment({
  label,
  on,
  muted,
  caret,
  expanded,
  onClick,
}: {
  label: string;
  on: boolean;
  muted?: boolean;
  caret?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-expanded={caret ? !!expanded : undefined}
      className={clsx(
        'figure rounded-sm border px-2 py-0.5 transition-colors',
        on
          ? 'border-ink-500 bg-ink-700 text-paper'
          : muted
            ? 'border-transparent text-paper-faint hover:border-ink-600 hover:text-paper-dim'
            : 'border-ink-700 text-paper-dim hover:border-ink-500 hover:text-paper',
      )}
    >
      {label}
      {caret && <span className="ml-1 text-ink-500" aria-hidden>▾</span>}
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
