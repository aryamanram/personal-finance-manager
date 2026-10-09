/**
 * The Flow's geometry (src/lib/flow-layout.ts): the trunk and the labels.
 *
 * The owner asked for Monarch's "one large cut from the left": the sources
 * stack into one bar, as tall as the junction and level with it, so their
 * ribbons run straight into it as one block and the money splits from there —
 * and then for that trunk to take "a good portion of the height", with
 * everything else splitting off from it. And with a sliver of a source flush
 * against a paycheck, labels have to be kept apart by something other than
 * the gap between nodes.
 */
import { describe, it, expect } from 'vitest';
import {
  buildFlow, buildCategoryFlow, flowGraph, categoryGraph,
  type FlowGraph, type FlowInput, type FlowRow,
} from '@/lib/flow';
import {
  layoutFlow, pack, placeLabels, EDGE, GAP, LABEL_H, TRUNK_HEIGHT, type FlowLayout, type LayoutNode,
} from '@/lib/flow-layout';

const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const WIDTH = 1200;

const row = (name: string, necessity: string, cents: number, group = 'Lifestyle'): FlowRow => ({
  category_id: name, category_name: name, category_group_name: group, parent_id: null,
  necessity, total_cents: cents, credit_cents: 0, txn_count: 1,
});

/** Spent more than came in, with a tiny credit: three sources, one of them a sliver. */
const overspent: FlowInput = {
  incomeCents: 100_000,
  investedCents: 0,
  creditsCents: 177,
  categories: [
    row('Rent', 'required', 90_000, 'Housing'),
    row('Groceries', 'required', 12_000, 'Food'),
    ...Array.from({ length: 12 }, (_, i) => row(`Small ${i}`, 'discretionary', 400 + i * 37)),
  ],
  groupSlots: { Housing: 1, Food: 3, Lifestyle: 5 },
};

function laid(graph: FlowGraph, trunkHeight?: number): FlowLayout {
  const l = layoutFlow(graph, WIDTH, { gaps: [1, 0.85, 1.25, 1.1], trunkHeight });
  if (!l) throw new Error('nothing laid out');
  return l;
}
const node = (l: FlowLayout, key: string) => {
  const n = l.nodes.find((m) => m.key === key);
  if (!n) throw new Error(`no node ${key}`);
  return n;
};
const top = (n: LayoutNode) => n.y0 ?? NaN;
const bottom = (n: LayoutNode) => n.y1 ?? NaN;

describe('the trunk', () => {
  const model = buildFlow(overspent)!;
  const l = laid(flowGraph(model, PERIOD, new Set(['bucket:discretionary'])));
  const junction = node(l, 'junction');
  const sources = l.nodes.filter((n) => n.column === 0).sort((a, b) => top(a) - top(b));

  it('stacks the sources flush, in order, from the top of the junction to its bottom', () => {
    expect(l.trunk).toBe('junction');
    expect(sources.map((n) => n.key)).toEqual(['source:income', 'source:credits', 'source:savings']);
    expect(top(sources[0])).toBeCloseTo(top(junction), 6);
    for (let i = 1; i < sources.length; i++) expect(top(sources[i])).toBeCloseTo(bottom(sources[i - 1]), 6);
    expect(bottom(sources[sources.length - 1])).toBeCloseTo(bottom(junction), 6);
  });

  it('runs every ribbon into the junction straight, so together they are one block', () => {
    const into = l.links.filter((k) => (k.target as LayoutNode).key === 'junction');
    expect(into).toHaveLength(3);
    for (const k of into) expect(k.y0).toBeCloseTo(k.y1 ?? NaN, 6);
    const widths = into.reduce((a, k) => a + (k.width ?? 0), 0);
    expect(widths).toBeCloseTo(bottom(junction) - top(junction), 6);
  });

  it('draws the whole of the money at the trunk height, from the top of the chart', () => {
    expect(top(junction)).toBe(EDGE);
    expect(bottom(junction) - top(junction)).toBeCloseTo(TRUNK_HEIGHT, 6);
    const taller = laid(flowGraph(model, PERIOD), 300);
    const j = node(taller, 'junction');
    expect(bottom(j) - top(j)).toBeCloseTo(300, 6);
  });

  it('hangs the buckets from the trunk\'s top edge, a gap apart', () => {
    const buckets = l.nodes.filter((n) => n.kind === 'bucket').sort((a, b) => top(a) - top(b));
    expect(buckets.map((b) => b.key)).toEqual(['bucket:required', 'bucket:discretionary']);
    expect(top(buckets[0])).toBe(EDGE);
    expect(top(buckets[1]) - bottom(buckets[0])).toBeCloseTo(GAP, 6);
  });

  it('runs the first category\'s ribbon straight from its bucket', () => {
    const rent = node(l, 'cat:required:Rent');
    expect(top(rent)).toBeCloseTo(top(node(l, 'bucket:required')), 6);
  });

  it('keeps every other column a gap apart, and grows the chart to fit rather than shrinking the trunk', () => {
    const every = laid(flowGraph(model, PERIOD, new Set(['bucket:required', 'bucket:discretionary'])));
    const columns = new Map<number, LayoutNode[]>();
    for (const n of every.nodes) if (n.column > 0) columns.set(n.column, [...(columns.get(n.column) ?? []), n]);
    for (const [column, nodes] of columns) {
      nodes.sort((a, b) => top(a) - top(b));
      for (let i = 1; i < nodes.length; i++) {
        expect(top(nodes[i]) - bottom(nodes[i - 1]), `column ${column}`).toBeGreaterThanOrEqual(GAP - 1e-6);
      }
    }
    const j = node(every, 'junction');
    expect(bottom(j) - top(j)).toBeCloseTo(TRUNK_HEIGHT, 6);
    expect(every.height).toBeGreaterThan(TRUNK_HEIGHT + 2 * EDGE);
    expect(every.height).toBeCloseTo(Math.max(...every.nodes.map((n) => bottom(n))) + EDGE, 6);
  });

  it('draws a seam between each pair of stacked sources, inside the taller one', () => {
    expect(l.seams).toHaveLength(2);
    // Income above the $1.77 credit: the seam is cut from Income, not from the sliver.
    expect(l.seams[0].y).toBeLessThan(bottom(sources[0]));
    expect(l.seams[0].y).toBeGreaterThan(top(sources[0]));
  });

  it('makes a trunk of the buckets that paid for a category, in its own Flow', () => {
    const c = buildCategoryFlow({ id: 'g', name: 'Groceries', group: 'Food', slot: 3 }, [
      { category_id: 'g', category_name: 'Groceries', necessity: 'required', merchant_id: 'a', merchant_name: 'A', total_cents: 9000, credit_cents: 0, txn_count: 2 },
      { category_id: 'g', category_name: 'Groceries', necessity: 'discretionary', merchant_id: 'b', merchant_name: 'B', total_cents: 1500, credit_cents: 0, txn_count: 1 },
    ])!;
    const own = laid(categoryGraph(c, PERIOD));
    const root = node(own, 'root');
    const paid = own.nodes.filter((n) => n.column === 0).sort((a, b) => top(a) - top(b));
    expect(own.trunk).toBe('root');
    expect(top(root)).toBe(EDGE);
    expect(paid).toHaveLength(2);
    expect(top(paid[0])).toBeCloseTo(top(root), 6);
    expect(top(paid[1])).toBeCloseTo(bottom(paid[0]), 6);
    expect(bottom(paid[1])).toBeCloseTo(bottom(root), 6);
  });

  it('is no trunk when the first column feeds more than one node', () => {
    const tone = { kind: 'strong' } as const;
    const n = (key: string, column: number, order: number) =>
      ({ key, column, order, name: key, label: key, kind: 'bucket' as const, cents: 100, tone });
    const l2 = laid({
      nodes: [n('a', 0, 0), n('b', 0, 1), n('c', 1, 2), n('d', 1, 3), n('e', 2, 4)],
      links: [
        { source: 'a', target: 'c', cents: 100, tone }, { source: 'b', target: 'd', cents: 100, tone },
        { source: 'c', target: 'e', cents: 100, tone }, { source: 'd', target: 'e', cents: 100, tone },
      ],
    });
    expect(l2.trunk).toBeNull();
    expect(l2.seams).toEqual([]);
  });
});

describe('packing a column', () => {
  it('leaves items where they want to be when they fit', () => {
    expect(pack([{ want: 20, size: 10 }, { want: 80, size: 10 }], 32, 16)).toEqual([20, 80]);
  });
  it('pushes a collision apart by exactly the gap, centred on the wants', () => {
    // Both want 100: the pair spans 10 + 32 + 10 and centres on 100.
    expect(pack([{ want: 100, size: 10 }, { want: 100, size: 10 }], 32, 16)).toEqual([79, 121]);
  });
  it('never goes above the top, and keeps the order it was given', () => {
    expect(pack([{ want: 0, size: 50 }, { want: 0, size: 5 }, { want: 0, size: 5 }], 0, 16)).toEqual([16, 66, 71]);
  });
});

describe('the labels', () => {
  it('never overlap in a column, and stay inside the drawing', () => {
    for (const expanded of [new Set<string>(), new Set(['bucket:discretionary'])]) {
      const l = laid(flowGraph(buildFlow(overspent)!, PERIOD, expanded));
      const columns = new Map<number, number[]>();
      for (const n of l.nodes) {
        if (!n.label) continue;
        columns.set(n.column, [...(columns.get(n.column) ?? []), l.labelY.get(n.key)!]);
      }
      for (const [column, ys] of columns) {
        ys.sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) {
          expect(ys[i] - ys[i - 1], `column ${column}`).toBeGreaterThanOrEqual(LABEL_H - 1e-9);
        }
        expect(ys[0]).toBeGreaterThanOrEqual(LABEL_H / 2);
        expect(ys[ys.length - 1]).toBeLessThanOrEqual(l.height - LABEL_H / 2);
      }
    }
  });

  it('sit at the middle of their node when there is room', () => {
    const l = laid(flowGraph(buildFlow(overspent)!, PERIOD));
    for (const key of ['junction', 'bucket:required', 'source:income']) {
      const n = node(l, key);
      expect(l.labelY.get(key), key).toBeCloseTo((top(n) + bottom(n)) / 2, 6);
    }
  });

  const at = (key: string, mid: number) =>
    ({ key, column: 0, label: key, y0: mid - 1, y1: mid + 1 }) as LayoutNode;

  it('spread a crowd evenly around where it wants to be', () => {
    const y = placeLabels([at('a', 200), at('b', 201), at('c', 202)], 600);
    expect([y.get('a'), y.get('b'), y.get('c')]).toEqual([201 - LABEL_H, 201, 201 + LABEL_H]);
  });

  it('push a crowd at an edge back inside, keeping its order', () => {
    const y = placeLabels([at('a', 2), at('b', 3)], 600);
    expect([y.get('a'), y.get('b')]).toEqual([LABEL_H / 2, LABEL_H / 2 + LABEL_H]);
    const z = placeLabels([at('a', 597), at('b', 598)], 600);
    expect([z.get('a'), z.get('b')]).toEqual([600 - LABEL_H / 2 - LABEL_H, 600 - LABEL_H / 2]);
  });

  it('merge a crowd into the one above when spreading it would collide', () => {
    const y = placeLabels([at('a', 100), at('b', 120), at('c', 140), at('d', 150)], 600);
    const ys = ['a', 'b', 'c', 'd'].map((k) => y.get(k)!);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(LABEL_H, 9);
    // Centred on the mean of where they wanted to be.
    expect(ys.reduce((a, v) => a + v, 0) / 4).toBeCloseTo((100 + 120 + 140 + 150) / 4, 9);
  });
});
