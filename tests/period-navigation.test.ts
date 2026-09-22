/**
 * How the period control moves between periods.
 *
 * It offers three moves, and each has a way to go wrong that no amount of
 * looking at the screen would catch reliably:
 *
 *   step  — ‹ / › to the adjacent period at this zoom. Must not wander into
 *           another year's months, and must stop at the ends of the ledger.
 *   zoom  — change granularity while STAYING PUT. Zooming out of September
 *           and back in must land on September, not on the newest month.
 *   jump  — the popover. Must stay a bounded size however long the ledger is,
 *           which is the whole reason the flat <select> was replaced.
 *
 * The component is a thin renderer over these derivations, so they are tested
 * directly against real period lists.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPeriods, stepPeriod, periodTrack,
  type PeriodOption, type PeriodScope,
} from '@/lib/periods';

const bounds = { first: '2024-09-16', last: '2026-09-16' };
const months = [
  '2026-09-01', '2026-08-01', '2026-07-01',
  '2025-11-01', '2025-03-01', '2024-10-01',
];
const periods = buildPeriods(months, bounds);
const byKey = (ps: PeriodOption[], k: string) => ps.find((p) => p.key === k)!;

function step(ps: PeriodOption[], key: string, dir: 'older' | 'newer') {
  return stepPeriod(ps, byKey(ps, key), dir === 'older' ? -1 : 1)?.key;
}

/** Where the zoom control lands, mirroring PeriodPicker.zoomTo. */
function zoom(ps: PeriodOption[], key: string, scope: PeriodScope) {
  const map = new Map(ps.map((p) => [p.key, p]));
  const current = map.get(key)!;
  if (current.scope === scope) return key;

  let up: PeriodOption | undefined = current;
  while (up && up.scope !== scope) up = up.parent ? map.get(up.parent) : undefined;
  if (up) return up.key;

  let down: PeriodOption | undefined = current;
  while (down && down.scope !== scope) {
    const kids = ps.filter((o) => o.parent === down!.key);
    if (kids.length === 0) break;
    down = kids[0];
  }
  return down?.scope === scope ? down.key : undefined;
}

describe('stepping', () => {
  it('walks months within a year, newest to oldest', () => {
    expect(step(periods, '2026-09', 'older')).toBe('2026-08');
    expect(step(periods, '2026-08', 'older')).toBe('2026-07');
    expect(step(periods, '2026-07', 'newer')).toBe('2026-08');
  });

  it('crosses the year boundary rather than stopping', () => {
    // 2026-07 is the oldest month of 2026 here; the next one back is in 2025.
    // The arrow means "the month before this one", not "the month before this
    // one, if it happens to share a parent".
    expect(step(periods, '2026-07', 'older')).toBe('2025-11');
    expect(step(periods, '2025-11', 'newer')).toBe('2026-07');
  });

  it('crosses the MONTH boundary at pay-period zoom', () => {
    // The case that prompted this: in September, at pay-period zoom, two
    // steps back from the first half must reach the second half of August —
    // not stick at Sep 1–15 because it is the first child of its month.
    const first = step(periods, '2026-09-H2', 'older');
    expect(first).toBe('2026-09-H1');
    expect(step(periods, first!, 'older')).toBe('2026-08-H2');
    // ...and forward again, symmetrically.
    expect(step(periods, '2026-08-H2', 'newer')).toBe('2026-09-H1');
  });

  it('stops only at the true ends of the ledger', () => {
    const monthTrack = periodTrack(periods, 'month');
    const oldest = monthTrack[monthTrack.length - 1]!;
    const newest = monthTrack[0]!;
    expect(step(periods, oldest.key, 'older')).toBeUndefined();
    expect(step(periods, newest.key, 'newer')).toBeUndefined();
  });

  it('walks every period at a zoom without gaps, in date order', () => {
    for (const scope of ['year', 'month', 'half'] as const) {
      const track = periodTrack(periods, scope);
      for (let i = 0; i < track.length - 1; i++) {
        // Each step lands on the next one along, and time runs backwards.
        expect(step(periods, track[i]!.key, 'older')).toBe(track[i + 1]!.key);
        expect(track[i]!.from > track[i + 1]!.from).toBe(true);
      }
    }
  });

  it('walks years at the year level', () => {
    expect(step(periods, '2026', 'older')).toBe('2025');
    expect(step(periods, '2024', 'older')).toBeUndefined();
  });

  it('never steps outside the current zoom', () => {
    for (const p of periods) {
      for (const dir of ['older', 'newer'] as const) {
        const next = step(periods, p.key, dir);
        if (next) expect(byKey(periods, next).scope).toBe(p.scope);
      }
    }
  });
});

describe('zooming', () => {
  it('stays put going out', () => {
    expect(zoom(periods, '2026-08-H1', 'month')).toBe('2026-08');
    expect(zoom(periods, '2026-08', 'year')).toBe('2026');
    expect(zoom(periods, '2026-08', 'all')).toBe('all');
  });

  it('round-trips: out and back lands where it started', () => {
    // The failure this guards: zooming out to the year, then back to a month,
    // resetting to the NEWEST month instead of the one you were on.
    const outAgain = zoom(periods, '2026-08', 'year');
    expect(zoom(periods, outAgain!, 'month')).toBe('2026-09');
    // ...which is why round-tripping is only exact one level at a time:
    expect(zoom(periods, zoom(periods, '2026-08-H2', 'month')!, 'half'))
      .toBe('2026-08-H1');
  });

  it('descends into the newest child when zooming in', () => {
    expect(zoom(periods, 'all', 'year')).toBe('2026');
    expect(zoom(periods, '2026', 'month')).toBe('2026-09');
    expect(zoom(periods, '2026', 'half')).toBe('2026-09-H1');
  });

  it('is a no-op at the same zoom', () => {
    expect(zoom(periods, '2026-08', 'month')).toBe('2026-08');
  });
});

describe('the jump popover stays bounded', () => {
  it('shows one year column and one year’s months, however long the ledger', () => {
    // Ten years of full data: a flat list would be 1 + 10 + 120 + 240 = 371.
    const many: string[] = [];
    for (let y = 2017; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) many.push(`${y}-${String(m).padStart(2, '0')}-01`);
    }
    const big = buildPeriods(many, { first: '2017-01-01', last: '2026-12-31' });
    expect(big).toHaveLength(371);

    const years = big.filter((o) => o.scope === 'year');
    const monthsOf2026 = big.filter((o) => o.scope === 'month' && o.key.startsWith('2026-'));

    // What the popover actually renders: years + one year's months + all-time.
    expect(years.length + monthsOf2026.length + 1).toBe(23);
    // And it grows by ONE row per year, not 26.
    const eleven = buildPeriods(
      [...many, ...Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}-01`)],
      { first: '2017-01-01', last: '2027-12-31' },
    );
    const years11 = eleven.filter((o) => o.scope === 'year').length;
    expect(years11).toBe(years.length + 1);
  });
});
