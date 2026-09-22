/**
 * What the period picker offers at each depth.
 *
 * The picker shows one level at a time rather than the whole hierarchy,
 * because a flat list grows by 26 entries a year. That only works if the rows
 * it derives — the trail up, the siblings at this depth, the children one
 * level down — are correct and do not overlap. The first version drew every
 * year twice at the root, because the sibling fallback and the children query
 * resolved to the same set.
 *
 * The component is a thin renderer over these three derivations, so they are
 * tested directly against real period lists.
 */
import { describe, it, expect } from 'vitest';
import { buildPeriods, type PeriodOption } from '@/lib/periods';

const bounds = { first: '2024-09-16', last: '2026-09-16' };
const months = [
  '2026-09-01', '2026-08-01', '2026-07-01',
  '2025-11-01', '2025-03-01', '2024-10-01',
];
const periods = buildPeriods(months, bounds);
const byKey = (key: string) => periods.find((p) => p.key === key)!;

/** The three rows the picker renders, mirroring PeriodPicker's derivation. */
function view(activeKey: string) {
  const map = new Map(periods.map((p) => [p.key, p]));
  const current = map.get(activeKey)!;

  const trail: PeriodOption[] = [];
  for (let p: PeriodOption | undefined = current; p; p = p.parent ? map.get(p.parent) : undefined) {
    trail.unshift(p);
  }

  const siblings = current.parent
    ? periods.filter((o) => o.parent === current.parent)
    : [];
  const children = periods.filter((o) => o.parent === current.key);
  const rows = siblings.length > 0 ? [siblings, children] : [children];

  return {
    trail: trail.map((p) => p.key),
    rows: rows.map((r) => r.map((p) => p.key)),
    /** Every control the user can click, across both rows. */
    controls: rows.flat().map((p) => p.key),
  };
}

describe('the trail', () => {
  it('walks all the way to the root from any depth', () => {
    expect(view('all').trail).toEqual(['all']);
    expect(view('2026').trail).toEqual(['all', '2026']);
    expect(view('2026-07').trail).toEqual(['all', '2026', '2026-07']);
    expect(view('2026-07-H1').trail).toEqual(['all', '2026', '2026-07', '2026-07-H1']);
  });
});

describe('the rows', () => {
  it('offers the years at the root, once', () => {
    // The bug: siblings fell back to the years AND children were the years,
    // so every year rendered twice.
    const v = view('all');
    expect(v.controls).toEqual(['2026', '2025', '2024']);
    expect(new Set(v.controls).size).toBe(v.controls.length);
  });

  it('offers sibling years and this year’s months', () => {
    const v = view('2026');
    expect(v.rows[0]).toEqual(['2026', '2025', '2024']);
    expect(v.rows[1]).toEqual(['2026-09', '2026-08', '2026-07']);
  });

  it('offers sibling months and this month’s halves', () => {
    const v = view('2026-07');
    expect(v.rows[0]).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(v.rows[1]).toEqual(['2026-07-H1', '2026-07-H2']);
  });

  it('offers only the sibling halves at the deepest level', () => {
    const v = view('2026-07-H1');
    expect(v.controls).toEqual(['2026-07-H1', '2026-07-H2']);
  });

  it('never repeats a control within one view', () => {
    for (const p of periods) {
      const c = view(p.key).controls;
      expect(new Set(c).size).toBe(c.length);
    }
  });

  it('never shows a year’s months under a different year', () => {
    // 2025 has months in the data too; standing on 2026 must not offer them.
    const v = view('2026');
    expect(v.rows[1].every((k) => k.startsWith('2026-'))).toBe(true);
  });
});

describe('it stays bounded as the ledger grows', () => {
  it('keeps the control count flat no matter how many years accumulate', () => {
    // Ten years of full data: a flat list would be 10 + 120 + 240 = 370
    // entries. The picker must still show only one level's worth.
    const many: string[] = [];
    for (let y = 2017; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) many.push(`${y}-${String(m).padStart(2, '0')}-01`);
    }
    const big = buildPeriods(many, { first: '2017-01-01', last: '2026-12-31' });
    const bigView = (key: string) => {
      const map = new Map(big.map((p) => [p.key, p]));
      const cur = map.get(key)!;
      const sib = cur.parent ? big.filter((o) => o.parent === cur.parent) : [];
      const kids = big.filter((o) => o.parent === cur.key);
      return (sib.length > 0 ? [sib, kids] : [kids]).flat();
    };

    expect(big.length).toBe(1 + 10 + 120 + 240);   // the flat list it replaces
    expect(bigView('all')).toHaveLength(10);        // one chip per year
    expect(bigView('2026')).toHaveLength(22);       // 10 years + 12 months
    expect(bigView('2026-06')).toHaveLength(14);    // 12 months + 2 halves
    expect(bigView('2026-06-H1')).toHaveLength(2);  // 2 halves
  });
});
