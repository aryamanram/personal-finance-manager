/**
 * Period construction for the cashflow view. Pure logic, deliberately NOT in
 * the PeriodPicker client component: a server component has to call it to
 * resolve the selected period before rendering.
 */

import { formatMonthShort } from './format-date';

export interface PeriodOption {
  key: string;
  label: string;
  from: string;
  to: string;
}

/**
 * Builds the period list from what the ledger actually contains: every month
 * with activity, each calendar year, and all time. Offering a month with no
 * transactions would be offering an empty chart.
 */
export function buildPeriods(
  months: string[],
  bounds: { first: string; last: string },
): PeriodOption[] {
  const out: PeriodOption[] = [];

  const recent = [...months].sort().reverse().slice(0, 6);
  for (const m of recent) {
    const start = new Date(`${m}T00:00:00`);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    out.push({
      key: m.slice(0, 7),
      label: formatMonthShort(m),
      from: m,
      to: iso(end),
    });
  }

  const years = Array.from(new Set(months.map((m) => m.slice(0, 4)))).sort().reverse();
  for (const y of years) {
    out.push({ key: y, label: y, from: `${y}-01-01`, to: `${y}-12-31` });
  }

  out.push({ key: 'all', label: 'All time', from: bounds.first, to: bounds.last });
  return out;
}

/** Formats a local calendar date as an ISO date string. */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
