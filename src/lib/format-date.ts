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
 * A register date: "Sep 16" within the current year, "Sep 16 '24" outside it.
 *
 * The ledger spans several years, so dropping the year entirely would make two
 * rows twelve months apart look adjacent. Carrying a full ISO date on all 396
 * rows is the other extreme — four characters of "2026-" repeated down a
 * column that is already sorted by date. This shows the year only when it is
 * not the one you are presumed to be looking at.
 */
export function formatRegisterDate(isoDate: string, currentYear: number): string {
  const { y, m, d } = parts(isoDate);
  const base = `${MONTHS[m - 1]} ${d}`;
  return y === currentYear ? base : `${base} '${String(y).slice(2)}`;
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
