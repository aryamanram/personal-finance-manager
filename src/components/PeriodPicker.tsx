'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { PeriodOption } from '@/lib/periods';

/**
 * Period selector for the cashflow view.
 *
 * A native <select> rather than a row of links: the list grows by one entry
 * every month this app runs, and a row of links would eventually wrap across
 * the header. A select stays one control forever, and gets keyboard handling,
 * scrolling and touch behaviour from the platform.
 *
 * The period lives in the URL rather than component state, so a view is
 * shareable and survives a reload.
 */
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

  // Group so months, years and all-time are visually separated in the list.
  const months = options.filter((o) => /^\d{4}-\d{2}$/.test(o.key));
  const years = options.filter((o) => /^\d{4}$/.test(o.key));
  const rest = options.filter((o) => !/^\d{4}(-\d{2})?$/.test(o.key));

  /** Navigates to the current page with the selected period in its query. */
  function go(key: string) {
    const next = new URLSearchParams(params.toString());
    next.set('period', key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">Period</span>
      <select
        value={active}
        onChange={(e) => go(e.target.value)}
        className="figure cursor-pointer rounded-sm border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-paper transition-colors hover:border-ink-500"
      >
        {months.length > 0 && (
          <optgroup label="Month">
            {months.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </optgroup>
        )}
        {years.length > 0 && (
          <optgroup label="Year">
            {years.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </optgroup>
        )}
        {rest.length > 0 && (
          <optgroup label="Everything">
            {rest.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
