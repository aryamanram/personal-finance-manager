/**
 * Period construction for the cashflow and flow views. Pure logic,
 * deliberately NOT in the PeriodPicker client component: a server component
 * has to call it to resolve the selected period before rendering.
 *
 * The list is a hierarchy, widest first:
 *
 *   all  →  2026  →  2026-09  →  2026-09-H1   (1st–15th)
 *                               2026-09-H2   (16th–end)
 *
 * Each level nests exactly inside the one above, which is why pay periods are
 * SEMI-MONTHLY rather than a strict 14 days. The owner is paid on the 15th and
 * the last day of the month, so halves line up with actual paycheques AND with
 * month boundaries. True fortnights would drift off both within a few months,
 * and a "biweekly" period straddling two months could not sit under either.
 */

import { formatMonthShort, formatMonthLong } from './format-date';

/** How far a period is zoomed in. Widest first, so it sorts naturally. */
export type PeriodScope = 'all' | 'year' | 'month' | 'half';

export interface PeriodOption {
  key: string;
  label: string;
  from: string;
  to: string;
  scope: PeriodScope;
  /**
   * The key of the period one level out — 'all' has none. Lets the picker
   * indent, and lets a caller walk back up without re-parsing the key.
   */
  parent?: string;
}

/** Matches a half-month key: 2026-09-H1. */
const HALF_KEY = /^(\d{4})-(\d{2})-H([12])$/;

/**
 * Builds the period list from what the ledger actually contains. A month with
 * no activity is never offered — an empty chart is worse than no option.
 *
 * Every month is offered, not just the recent few: with two years of history
 * the old six-month cap hid most of the ledger from the picker.
 */
export function buildPeriods(
  months: string[],
  bounds: { first: string; last: string },
): PeriodOption[] {
  const out: PeriodOption[] = [];

  out.push({
    key: 'all',
    label: 'All time',
    from: bounds.first,
    to: bounds.last,
    scope: 'all',
  });

  const sorted = [...new Set(months)].sort().reverse();
  const years = [...new Set(sorted.map((m) => m.slice(0, 4)))].sort().reverse();

  for (const year of years) {
    // Clamp to the ledger. A partial year must not claim January when the
    // data starts in September, or December when it ends in September: the
    // range would reach outside all-time, and zooming out from the year to
    // all-time could then show LESS money than the year did.
    out.push({
      key: year,
      label: year,
      from: maxDate(`${year}-01-01`, bounds.first),
      to: minDate(`${year}-12-31`, bounds.last),
      scope: 'year',
      parent: 'all',
    });

    for (const m of sorted.filter((x) => x.startsWith(year))) {
      const monthKey = m.slice(0, 7);
      const start = new Date(`${m}T00:00:00`);
      const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

      out.push({
        key: monthKey,
        label: formatMonthShort(m),
        from: maxDate(`${monthKey}-01`, bounds.first),
        to: minDate(`${monthKey}-${pad(lastDay)}`, bounds.last),
        scope: 'month',
        parent: year,
      });

      // Paycheque to paycheque. Labelled by the days they cover rather than
      // "H1 / H2", which says nothing on its own.
      // A half outside the ledger entirely is not offered at all: the first
      // half of the month the data starts mid-way through is an empty chart.
      const halves = [
        { key: `${monthKey}-H1`, label: '1st – 15th',
          from: `${monthKey}-01`, to: `${monthKey}-15` },
        { key: `${monthKey}-H2`, label: `16th – ${ordinal(lastDay)}`,
          from: `${monthKey}-16`, to: `${monthKey}-${pad(lastDay)}` },
      ];
      for (const h of halves) {
        if (h.to < bounds.first || h.from > bounds.last) continue;
        out.push({
          ...h,
          from: maxDate(h.from, bounds.first),
          to: minDate(h.to, bounds.last),
          scope: 'half',
          parent: monthKey,
        });
      }
    }
  }

  return out;
}

/**
 * Every period at one zoom level, newest first — the track the ‹ / › arrows
 * walk along.
 *
 * Deliberately flat across the whole ledger rather than scoped to the parent.
 * Stepping back from the first half of September should reach the second half
 * of August, not stop dead at a month boundary: the arrows mean "the period
 * before this one", and a pay period before the 1st is last month's, whatever
 * the tree says about parentage.
 */
export function periodTrack(
  periods: PeriodOption[],
  scope: PeriodScope,
): PeriodOption[] {
  return periods
    .filter((p) => p.scope === scope)
    .sort((a, b) => b.from.localeCompare(a.from));
}

/**
 * The period one step older (`-1`) or newer (`+1`) at the same zoom.
 *
 * Returns undefined only at the true ends of the ledger, so an arrow disables
 * only when there is genuinely nothing further to see.
 */
export function stepPeriod(
  periods: PeriodOption[],
  current: PeriodOption,
  direction: -1 | 1,
): PeriodOption | undefined {
  const track = periodTrack(periods, current.scope);
  const at = track.findIndex((p) => p.key === current.key);
  if (at === -1) return undefined;
  // The track is newest-first, so "older" means a HIGHER index.
  return track[at + (direction === -1 ? 1 : -1)];
}

/**
 * A human name for a period, for page headings.
 *
 * The picker's own labels are deliberately terse because they sit under an
 * indented parent that supplies the context; a heading has no such parent.
 */
export function describePeriod(p: PeriodOption): string {
  if (p.scope === 'all') return 'All time';
  if (p.scope === 'year') return p.key;
  if (p.scope === 'month') return formatMonthLong(`${p.key}-01`);

  const m = HALF_KEY.exec(p.key);
  if (!m) return p.label;
  const month = formatMonthLong(`${m[1]}-${m[2]}-01`);
  return `${month}, ${m[3] === '1' ? 'first half' : 'second half'}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 28th, 29th, 30th, 31st — a month can end on any of them. */
function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st'
    : n % 10 === 2 && n % 100 !== 12 ? 'nd'
    : n % 10 === 3 && n % 100 !== 13 ? 'rd'
    : 'th';
  return `${n}${suffix}`;
}

/** ISO dates sort lexically, so string comparison is date comparison. */
function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}
