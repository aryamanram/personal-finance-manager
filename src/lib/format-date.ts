/**
 * Date formatting that produces the SAME string on the server and in the
 * browser.
 *
 * `toLocaleDateString` resolves against the running environment's timezone and
 * locale. The server renders in the host's zone (America/Chicago here) and the
 * browser in the viewer's, so a timestamp near midnight formats differently in
 * each and React reports a hydration mismatch. These helpers format explicitly
 * instead of asking the platform.
 *
 * A DATE column is already a plain yyyy-mm-dd string with no timezone, so it is
 * split rather than passed through the Date constructor — `new Date('2026-09-01')`
 * parses as UTC midnight and shifts a day west of Greenwich.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Extracts calendar fields from an ISO date without applying a timezone. */
function parts(isoDate: string): { y: number; m: number; d: number } {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** "2026-09-01" -> "September 2026" */
export function formatMonthLong(isoDate: string): string {
  const { y, m } = parts(isoDate);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "2026-09-01" -> "Sep 26" */
export function formatMonthShort(isoDate: string): string {
  const { y, m } = parts(isoDate);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

/** "2026-09-01" -> "Sep" */
export function formatMonthAbbrev(isoDate: string): string {
  return MONTHS[parts(isoDate).m - 1];
}

/** "2026-09-16" -> "Sep 16" */
export function formatDayShort(isoDate: string): string {
  const { m, d } = parts(isoDate);
  return `${MONTHS[m - 1]} ${d}`;
}

/**
 * A register date: "Sep 16 '26", always with the year.
 *
 * The year used to be omitted for the year you were presumed to be looking
 * at, on the reasoning that it was four repeated characters down a column
 * already sorted by date. But "presumed" is the problem: the register shows
 * all time by default and the period picker can put any span on screen, so a
 * bare "Sep 16" is only unambiguous if you already know which year you asked
 * for. A date that has to be inferred from context is not a date, and this
 * ledger is about money — two rows twelve months apart must never be able to
 * look adjacent.
 */
export function formatRegisterDate(isoDate: string): string {
  const { y, m, d } = parts(isoDate);
  return `${MONTHS[m - 1]} ${d} '${String(y).slice(2)}`;
}

/**
 * A timestamptz to "Sep 16". Formatted in UTC deliberately: the alternative is
 * the server's zone, which the browser does not share.
 */
export function formatTimestampShort(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** A timestamptz to "Sep 16, 2026, 14:55 UTC". */
export function formatTimestampLong(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}
