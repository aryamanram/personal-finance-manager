'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import type { PeriodOption, PeriodScope } from '@/lib/periods';

/**
 * Period selector for the cashflow and flow views.
 *
 *   ‹  September 2026  ›   Month ▾
 *
 * Three ideas, in the order they earn their place:
 *
 * 1. STEPPING is the common case. Looking at one month almost always means
 *    next wanting the month before it. That is an arrow, not a hunt through a
 *    list — the pattern YNAB uses on its plan header.
 * 2. GRANULARITY is a separate control from WHICH ONE. Monarch keeps its
 *    timeframe dropdown apart from its date filter for the same reason:
 *    folding them together turns n periods × m zoom levels into one flat list
 *    of n×m entries, which is exactly what the old <select> was.
 * 3. JUMPING far is rare, so it hides behind the label. Clicking it opens
 *    years beside that year's months — two short columns rather than a tree,
 *    so a decade of data is still one glance.
 *
 * Everything lives in the URL, so a view is shareable and survives a reload.
 */

/** Zoom levels, widest first. */
const ZOOMS: { scope: PeriodScope; label: string }[] = [
  { scope: 'all', label: 'All time' },
  { scope: 'year', label: 'Year' },
  { scope: 'month', label: 'Month' },
  { scope: 'half', label: 'Pay period' },
];

export function PeriodPicker({
  options,
  active,
  align = 'end',
}: {
  options: PeriodOption[];
  active: string;
  /** Which edge the control hangs from; the dashboard stacks it under a heading. */
  align?: 'start' | 'end';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<null | 'jump' | 'zoom'>(null);
  const root = useRef<HTMLDivElement>(null);

  const byKey = new Map(options.map((o) => [o.key, o]));
  const current = byKey.get(active) ?? options[0]!;

  function go(key: string) {
    const next = new URLSearchParams(params.toString());
    next.set('period', key);
    router.push(`${pathname}?${next.toString()}`);
    setOpen(null);
  }

  // Close on an outside click or Escape — a popover that traps you is worse
  // than the dropdown it replaced.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Siblings at this zoom, sorted newest first so ‹ always means older.
  //
  // Sorted explicitly rather than trusting emission order: buildPeriods lists
  // months newest-first but a month's two halves oldest-first, so reading the
  // array directly made ‹ mean "older" for months and "newer" for halves.
  const siblings = options
    .filter((o) => o.scope === current.scope
      && (current.scope === 'year' || o.parent === current.parent))
    .sort((a, b) => b.from.localeCompare(a.from));
  const at = siblings.findIndex((o) => o.key === current.key);
  const older = at >= 0 ? siblings[at + 1] : undefined;
  const newer = at > 0 ? siblings[at - 1] : undefined;

  /**
   * Changing zoom keeps you where you are rather than resetting to the newest
   * period: zooming out from September lands on 2026, and back in lands on
   * September again. Walking the parent chain is what makes that true.
   */
  function zoomTo(scope: PeriodScope) {
    if (scope === current.scope) { setOpen(null); return; }

    let up: PeriodOption | undefined = current;
    while (up && up.scope !== scope) up = up.parent ? byKey.get(up.parent) : undefined;
    if (up) { go(up.key); return; }

    let down: PeriodOption | undefined = current;
    while (down && down.scope !== scope) {
      const kids = options.filter((o) => o.parent === down!.key);
      if (kids.length === 0) break;
      down = kids[0];
    }
    if (down && down.scope === scope) { go(down.key); return; }
    setOpen(null);
  }

  const zoomLabel = ZOOMS.find((z) => z.scope === current.scope)?.label ?? 'Period';

  return (
    <div
      ref={root}
      className={clsx('relative flex flex-col', align === 'end' ? 'items-end' : 'items-start')}
    >
      <div className="flex items-center gap-0.5">
        <Step dir="older" onClick={() => older && go(older.key)} disabled={!older} />

        <button
          onClick={() => setOpen((v) => (v === 'jump' ? null : 'jump'))}
          aria-expanded={open === 'jump'}
          className="min-w-[104px] rounded-sm px-1.5 py-1 text-center text-sm text-paper transition-colors hover:bg-ink-800 sm:min-w-[132px] sm:px-2"
        >
          {label(current)}
        </button>

        <Step dir="newer" onClick={() => newer && go(newer.key)} disabled={!newer} />

        <button
          onClick={() => setOpen((v) => (v === 'zoom' ? null : 'zoom'))}
          aria-expanded={open === 'zoom'}
          className="eyebrow ml-0.5 rounded-sm px-1.5 py-1 transition-colors hover:bg-ink-800 hover:text-paper-dim sm:ml-1 sm:px-2"
        >
          {zoomLabel} ▾
        </button>
      </div>

      {open === 'zoom' && (
        <Popover align={align}>
          <div className="flex flex-col gap-0.5">
            {ZOOMS.map((z) => (
              <Row key={z.scope} on={z.scope === current.scope} onClick={() => zoomTo(z.scope)}>
                {z.label}
              </Row>
            ))}
          </div>
        </Popover>
      )}

      {open === 'jump' && (
        <Popover align={align} wide>
          <JumpTree options={options} current={current} onPick={go} />
        </Popover>
      )}
    </div>
  );
}

/** Years beside the months of whichever year you are in. */
function JumpTree({
  options,
  current,
  onPick,
}: {
  options: PeriodOption[];
  current: PeriodOption;
  onPick: (key: string) => void;
}) {
  const inYear = /^\d{4}/.test(current.key) ? current.key.slice(0, 4) : undefined;
  const years = options.filter((o) => o.scope === 'year');
  const [shownYear, setShownYear] = useState(inYear ?? years[0]?.key);
  const months = options.filter(
    (o) => o.scope === 'month' && o.key.startsWith(`${shownYear}-`),
  );

  return (
    <div className="flex gap-3">
      <div className="flex min-w-[76px] flex-col gap-0.5">
        <div className="eyebrow px-2 pb-1">Jump to</div>
        <Row on={current.key === 'all'} onClick={() => onPick('all')}>All time</Row>
        {years.map((y) => (
          <Row
            key={y.key}
            on={y.key === current.key}
            dim={y.key !== shownYear}
            // Selecting a year both navigates AND reveals its months, so the
            // next click is one away rather than reopening the popover.
            onClick={() => { setShownYear(y.key); onPick(y.key); }}
          >
            {y.label}
          </Row>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-0.5 border-l border-ink-700 pl-3">
        <div className="eyebrow col-span-3 px-2 pb-1">{shownYear}</div>
        {months.map((m) => (
          <Row key={m.key} on={m.key === current.key} onClick={() => onPick(m.key)}>
            {m.label.replace(/\s+\d{2}$/, '')}
          </Row>
        ))}
      </div>
    </div>
  );
}

function Popover({
  align,
  wide,
  children,
}: {
  align: 'start' | 'end';
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        'absolute top-full z-30 mt-1 rounded-sm border border-ink-600 bg-ink-800 p-2 shadow-2xl shadow-black/50',
        wide ? 'min-w-[250px]' : 'min-w-[128px]',
        align === 'end' ? 'right-0' : 'left-0',
      )}
    >
      {children}
    </div>
  );
}

function Row({
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
        'figure rounded-sm px-2 py-1 text-left text-xs transition-colors',
        on ? 'bg-ink-700 text-paper'
          : dim ? 'text-paper-faint hover:bg-ink-700 hover:text-paper-dim'
            : 'text-paper-dim hover:bg-ink-700 hover:text-paper',
      )}
    >
      {children}
    </button>
  );
}

function Step({
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
      className={clsx(
        'rounded-sm px-1.5 py-1 text-sm transition-colors',
        disabled
          ? 'cursor-default text-ink-600'
          : 'text-paper-faint hover:bg-ink-800 hover:text-paper',
      )}
    >
      {dir === 'older' ? '‹' : '›'}
    </button>
  );
}

/**
 * The label on the control. Full enough to stand alone: it is the only thing
 * naming the period once the trail is gone.
 */
function label(p: PeriodOption): string {
  if (p.scope === 'all') return 'All time';
  if (p.scope === 'year') return p.key;
  if (p.scope === 'month') return p.label;
  // A half needs its month for context: "1st – 15th" alone says nothing.
  const [y, m] = p.key.split('-');
  const month = new Date(`${y}-${m}-01T00:00:00`)
    .toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${p.label}`;
}
