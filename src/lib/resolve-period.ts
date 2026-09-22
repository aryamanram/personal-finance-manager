/**
 * Picks the period a page should open on.
 *
 * Extracted when Flow became its own page: both read the same `?period=` and
 * must agree on the default, or navigating between them silently changes the
 * month you are looking at.
 */

import type { PeriodOption } from './periods';
import type { MonthlyCashflow } from './types';

export function resolvePeriod(
  periods: PeriodOption[],
  cashflow: MonthlyCashflow[],
  requested: string | undefined,
): PeriodOption {
  // Default to the most recent month that actually had money moving, rather
  // than the current calendar month — which, part-way through, or in a month
  // with no income, has nothing worth charting.
  // Months only. The list now also holds years and half-months, and a year
  // key prefix-matches its own months ('2026-09-01'.startsWith('2026')), so
  // an unfiltered scan would default to the whole year instead of the latest
  // month with activity.
  const fallback =
    periods.filter((p) => p.scope === 'month').find((p) => {
      const row = cashflow.find((m) => m.month.startsWith(p.key));
      // Any movement counts. Testing income and discretionary only meant a
      // month of nothing but rent opened an older period instead.
      return row && [
        row.income_cents, row.required_cents,
        row.discretionary_cents, row.invested_cents,
      ].some((cents) => (cents ?? 0) > 0);
    }) ?? periods.find((p) => p.scope === 'month') ?? periods[0]!;

  return periods.find((p) => p.key === requested) ?? fallback;
}
