/**
 * These formatters exist because toLocaleDateString resolves against the
 * running environment. The server renders in the host's timezone and the
 * browser in the viewer's, so the same value formats differently in each and
 * React reports a hydration mismatch.
 *
 * The tests below run the formatters under several timezones to prove the
 * output does not depend on the environment.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  formatMonthLong, formatMonthShort, formatMonthAbbrev,
  formatDayShort, formatTimestampShort, formatTimestampLong,
} from '@/lib/format-date';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  // Assigning undefined stores the literal string "undefined", which leaves
  // later tests in an altered timezone and makes them order-dependent.
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('date formatting is timezone-independent', () => {
  const zones = ['UTC', 'America/Chicago', 'Asia/Tokyo', 'Pacific/Kiritimati'];

  it('formats a DATE the same everywhere', () => {
    for (const tz of zones) {
      process.env.TZ = tz;
      // 2026-09-01 must never read as August, which is what
      // new Date('2026-09-01') gives west of Greenwich.
      expect(formatMonthLong('2026-09-01')).toBe('September 2026');
      expect(formatMonthShort('2026-09-01')).toBe('Sep 26');
      expect(formatMonthAbbrev('2026-09-01')).toBe('Sep');
      expect(formatDayShort('2026-09-16')).toBe('Sep 16');
    }
  });

  it('formats a timestamptz the same everywhere', () => {
    // Late-evening UTC is the case that shifts a day in a western zone.
    const ts = '2026-09-16T23:30:00.000Z';
    const seen = new Set<string>();
    for (const tz of zones) {
      process.env.TZ = tz;
      seen.add(formatTimestampShort(ts));
      seen.add(formatTimestampLong(ts));
    }
    expect(seen.size).toBe(2);           // one short form, one long form
    expect(formatTimestampShort(ts)).toBe('Sep 16');
    expect(formatTimestampLong(ts)).toBe('Sep 16, 2026, 23:30 UTC');
  });

  it('handles the first and last day of a month', () => {
    expect(formatDayShort('2026-01-01')).toBe('Jan 1');
    expect(formatDayShort('2026-12-31')).toBe('Dec 31');
    expect(formatMonthLong('2026-12-01')).toBe('December 2026');
  });

  it('accepts a Date as well as a string', () => {
    expect(formatTimestampShort(new Date('2026-03-05T12:00:00Z'))).toBe('Mar 5');
  });
});
