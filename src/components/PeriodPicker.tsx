'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { PeriodOption } from '@/lib/periods';

/**
 * Period selector for the cashflow and flow views.
 *
 * A native <select> rather than a row of links or a custom menu: the list
 * grows by two entries every month this app runs, and it gets keyboard
 * handling, scrolling and touch behaviour from the platform for free.
 *
 * The list is a hierarchy — all time, then each year, then that year's months,
 * then each month's two pay periods — and the nesting is carried by
 * indentation rather than by nested <optgroup>, which HTML does not allow.
 * A leading space is the only tool a native option has; it is enough, because
 * the labels shorten as you descend ("2026" → "Sep" → "1st – 15th") so depth
 * reads from the shape of the list as much as the indent.
 *
 * The period lives in the URL rather than component state, so a view is
 * shareable and survives a reload.
 */

/** Indent per level. Figure space (U+2007) keeps width stable in any font. */
const INDENT: Record<string, string> = {
  all: '',
  year: '',
  month: '  ',
  half: '    ',
};

export function PeriodPicker({
  options,
  active,
}: {
  options: PeriodOption[];
  active: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /** Navigates to the current page with the selected period in its query. */
  function go(key: string) {
    const next = new URLSearchParams(params.toString());
    next.set('period', key);
    router.push(`${pathname}?${next.toString()}`);
  }

  // buildPeriods already emits the hierarchy in order — all, then each year
  // followed by its own months and halves — so rendering is a straight map.
  // Re-deriving the order here would be a second place to keep it correct.
  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">Period</span>
      <select
        value={active}
        onChange={(e) => go(e.target.value)}
        className="figure max-w-[220px] cursor-pointer rounded-sm border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-paper transition-colors hover:border-ink-500"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {INDENT[o.scope] ?? ''}{o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
