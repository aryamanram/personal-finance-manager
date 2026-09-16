/**
 * Period construction for the cashflow view.
 */
import { describe, it, expect } from 'vitest';
import { buildPeriods } from '@/lib/periods';

const bounds = { first: '2024-09-16', last: '2026-09-16' };

describe('buildPeriods', () => {
  const months = [
    '2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01',
    '2026-05-01', '2026-04-01', '2025-11-01', '2024-10-01',
  ];

  it('offers the six most recent months, newest first', () => {
    const p = buildPeriods(months, bounds);
    const monthKeys = p.filter((x) => /^\d{4}-\d{2}$/.test(x.key)).map((x) => x.key);
    expect(monthKeys).toEqual([
      '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04',
    ]);
  });

  it('spans each month from its first to its last day', () => {
    const sep = buildPeriods(months, bounds).find((p) => p.key === '2026-09')!;
    expect(sep.from).toBe('2026-09-01');
    expect(sep.to).toBe('2026-09-30');

    // February, to catch a naive +1-month-minus-a-day.
    const feb = buildPeriods(['2026-02-01'], bounds).find((p) => p.key === '2026-02')!;
    expect(feb.to).toBe('2026-02-28');
  });

  it('offers each calendar year present in the data', () => {
    const years = buildPeriods(months, bounds)
      .filter((x) => /^\d{4}$/.test(x.key)).map((x) => x.key);
    expect(years).toEqual(['2026', '2025', '2024']);
  });

  it('bounds all-time by the ledger, not by today', () => {
    const all = buildPeriods(months, bounds).find((p) => p.key === 'all')!;
    expect(all.from).toBe(bounds.first);
    expect(all.to).toBe(bounds.last);
  });

  it('never offers a month with no activity', () => {
    // 2026-07 is absent from this list, so it must not be offered — an empty
    // chart is worse than no option.
    const p = buildPeriods(['2026-09-01', '2026-08-01'], bounds);
    expect(p.some((x) => x.key === '2026-07')).toBe(false);
  });
});
