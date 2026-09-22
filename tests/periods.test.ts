/**
 * Period construction for the cashflow and flow views.
 *
 * The list is a hierarchy — all → year → month → half — and the property that
 * matters is that each level nests exactly inside the one above. A half that
 * escaped its month, or a month that escaped its year, would make zooming in
 * change the money on screen for reasons unrelated to the data.
 */
import { describe, it, expect } from 'vitest';
import { buildPeriods, describePeriod, type PeriodOption } from '@/lib/periods';

/** Real-world bounds: a ledger starting and ending mid-month. */
const bounds = { first: '2024-09-16', last: '2026-09-16' };

/** Wide bounds, so a test about shape is not also a test about clamping. */
const wide = { first: '2000-01-01', last: '2099-12-31' };

const months = [
  '2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01',
  '2026-05-01', '2026-04-01', '2025-11-01', '2024-10-01',
];

const byKey = (ps: PeriodOption[], key: string) => ps.find((p) => p.key === key)!;

describe('buildPeriods — the levels', () => {
  it('bounds all-time by the ledger, not by today', () => {
    const all = byKey(buildPeriods(months, bounds), 'all');
    expect(all.from).toBe(bounds.first);
    expect(all.to).toBe(bounds.last);
    expect(all.scope).toBe('all');
  });

  it('offers each calendar year present in the data, newest first', () => {
    const years = buildPeriods(months, bounds)
      .filter((p) => p.scope === 'year').map((p) => p.key);
    expect(years).toEqual(['2026', '2025', '2024']);
  });

  it('offers EVERY month with activity, not just the recent few', () => {
    // The old builder capped this at six, which hid most of a two-year ledger.
    const monthKeys = buildPeriods(months, bounds)
      .filter((p) => p.scope === 'month').map((p) => p.key);
    expect(monthKeys).toHaveLength(months.length);
    expect(monthKeys).toContain('2024-10');
    expect(monthKeys).toContain('2025-11');
  });

  it('never offers a month with no activity', () => {
    const p = buildPeriods(['2026-09-01', '2026-08-01'], bounds);
    expect(p.some((x) => x.key === '2026-07')).toBe(false);
  });

  it('spans each month from its first to its last day', () => {
    const sep = byKey(buildPeriods(months, wide), '2026-09');
    expect(sep.from).toBe('2026-09-01');
    expect(sep.to).toBe('2026-09-30');

    // February, to catch a naive +1-month-minus-a-day.
    const feb = byKey(buildPeriods(['2026-02-01'], wide), '2026-02');
    expect(feb.to).toBe('2026-02-28');
  });
});

describe('semi-monthly halves — paycheque to paycheque', () => {
  it('splits a month on the 15th, the day the first cheque lands', () => {
    const ps = buildPeriods(['2026-09-01'], wide);
    expect(byKey(ps, '2026-09-H1').from).toBe('2026-09-01');
    expect(byKey(ps, '2026-09-H1').to).toBe('2026-09-15');
    expect(byKey(ps, '2026-09-H2').from).toBe('2026-09-16');
    expect(byKey(ps, '2026-09-H2').to).toBe('2026-09-30');
  });

  it('ends the second half on the real last day, including February', () => {
    expect(byKey(buildPeriods(['2026-02-01'], wide), '2026-02-H2').to)
      .toBe('2026-02-28');
    // A leap year, which a hardcoded 28 would get wrong.
    expect(byKey(buildPeriods(['2028-02-01'], wide), '2028-02-H2').to)
      .toBe('2028-02-29');
  });

  it('covers the month with no gap and no overlap', () => {
    // The whole point of semi-monthly over 14-day: the two halves tile the
    // month exactly, so zooming out from a half cannot change the total.
    for (const m of ['2026-01-01', '2026-02-01', '2026-09-01', '2026-11-01']) {
      const ps = buildPeriods([m], wide);
      const key = m.slice(0, 7);
      const month = byKey(ps, key);
      const h1 = byKey(ps, `${key}-H1`);
      const h2 = byKey(ps, `${key}-H2`);

      expect(h1.from).toBe(month.from);
      expect(h2.to).toBe(month.to);
      // No gap: H2 starts the day after H1 ends.
      expect(dayAfter(h1.to)).toBe(h2.from);
    }
  });
});

describe('the hierarchy nests', () => {
  it('points every period at its parent', () => {
    const ps = buildPeriods(['2026-09-01'], wide);
    expect(byKey(ps, 'all').parent).toBeUndefined();
    expect(byKey(ps, '2026').parent).toBe('all');
    expect(byKey(ps, '2026-09').parent).toBe('2026');
    expect(byKey(ps, '2026-09-H1').parent).toBe('2026-09');
    expect(byKey(ps, '2026-09-H2').parent).toBe('2026-09');
  });

  it('contains every child inside its parent range', () => {
    const ps = buildPeriods(months, bounds);
    for (const child of ps) {
      if (!child.parent) continue;
      const parent = byKey(ps, child.parent);
      expect(child.from >= parent.from).toBe(true);
      expect(child.to <= parent.to).toBe(true);
    }
  });

  it('names every parent that is referenced', () => {
    const ps = buildPeriods(months, bounds);
    const keys = new Set(ps.map((p) => p.key));
    for (const p of ps) {
      if (p.parent) expect(keys.has(p.parent)).toBe(true);
    }
  });
});

describe('half labels', () => {
  it('uses the right ordinal for whichever day the month ends on', () => {
    const label = (m: string) =>
      byKey(buildPeriods([m], wide), `${m.slice(0, 7)}-H2`).label;
    expect(label('2026-01-01')).toBe('16th – 31st');
    expect(label('2026-02-01')).toBe('16th – 28th');
    expect(label('2028-02-01')).toBe('16th – 29th');
    expect(label('2026-09-01')).toBe('16th – 30th');
  });
});

describe('clamping to the ledger', () => {
  it('never lets a child reach outside all-time', () => {
    // The ledger starts 2024-09-16 and ends 2026-09-16, so 2024 must not
    // claim January and 2026-09 must not claim the 30th. Otherwise zooming
    // out could show LESS money than the level you zoomed out from.
    const ps = buildPeriods(months, bounds);
    expect(byKey(ps, '2024').from).toBe('2024-09-16');
    expect(byKey(ps, '2026').to).toBe('2026-09-16');
    expect(byKey(ps, '2026-09').to).toBe('2026-09-16');
    expect(byKey(ps, '2026-09-H2').to).toBe('2026-09-16');
  });

  it('drops a half that lies entirely outside the ledger', () => {
    // Data starts 2024-09-16, so the first half of that month is empty.
    const ps = buildPeriods(['2024-09-01'], bounds);
    expect(ps.some((p) => p.key === '2024-09-H1')).toBe(false);
    expect(ps.some((p) => p.key === '2024-09-H2')).toBe(true);
  });
});

describe('describePeriod', () => {
  it('names each level in a form a heading can use', () => {
    const ps = buildPeriods(['2026-09-01'], wide);
    expect(describePeriod(byKey(ps, 'all'))).toBe('All time');
    expect(describePeriod(byKey(ps, '2026'))).toBe('2026');
    expect(describePeriod(byKey(ps, '2026-09'))).toBe('September 2026');
    expect(describePeriod(byKey(ps, '2026-09-H1'))).toBe('September 2026, first half');
    expect(describePeriod(byKey(ps, '2026-09-H2'))).toBe('September 2026, second half');
  });
});

/** Next calendar day, as an ISO date. */
function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
