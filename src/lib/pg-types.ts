/**
 * Shared postgres.js type parsers. Used by the app pool, scripts, and tests so
 * a value has exactly one representation everywhere.
 */
import type { Options } from 'postgres';

/** OIDs we override. */
const BIGINT_OID = 20;
const NUMERIC_OID = 1700;
const DATE_OID = 1082;

export const pgTypes = {
  /**
   * BIGINT (cents) arrives as a string by default. Every monetary value in this
   * schema sits far inside Number.MAX_SAFE_INTEGER ($90 trillion), so parse to
   * number — and throw rather than silently truncate if that ever stops holding.
   */
  bigint: {
    to: BIGINT_OID,
    from: [BIGINT_OID],
    serialize: (v: number | bigint) => v.toString(),
    parse: (v: string) => {
      const n = Number(v);
      if (!Number.isSafeInteger(n)) throw new Error(`bigint out of safe range: ${v}`);
      return n;
    },
  },

  /**
   * DATE has no time and no timezone. Converting it to a JS Date puts it at
   * LOCAL midnight, so a posted_date of 2026-08-20 read west of UTC stringifies
   * back as 2026-08-19 — every report silently shifts by a day. Keep the wire
   * format: an ISO yyyy-mm-dd string.
   */
  /**
   * NUMERIC arrives as a string because it is arbitrary-precision. Every
   * numeric in this schema is either a SUM of cents (an integer) or a small
   * ratio (confidence, return_pct) — both exact in a double. Left as strings,
   * `income_cents + 1` silently concatenates instead of adding, which is the
   * kind of bug that shows up as a wrong number on a chart and nowhere else.
   */
  numeric: {
    to: NUMERIC_OID,
    from: [NUMERIC_OID],
    serialize: (v: number | string) => v.toString(),
    parse: (v: string) => {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`numeric not finite: ${v}`);
      return n;
    },
  },

  date: {
    to: DATE_OID,
    from: [DATE_OID],
    serialize: (v: string | Date) =>
      typeof v === 'string' ? v : v.toISOString().slice(0, 10),
    parse: (v: string) => v,
  },
} satisfies Options<{}>['types'];
