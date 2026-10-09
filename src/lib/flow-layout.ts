/**
 * Where the Flow's nodes, ribbons and labels go, in pixels, for a given width.
 *
 * Pure — no React, no DOM — so the geometry is tested directly. d3-sankey
 * lays the graph out; then the first column becomes a trunk when it can, the
 * columns move to the gaps asked for, and each column's labels are spread so
 * none overlap.
 */
import { sankey, type SankeyGraph, type SankeyLink, type SankeyNode } from 'd3-sankey';
import type { FlowGraph, GraphNode, Tone } from './flow';

type N = GraphNode;
type L = { source: string; target: string; value: number; tone: Tone };
export type LayoutNode = SankeyNode<N, L>;
export type LayoutLink = SankeyLink<N, L>;

export const NODE_W = 14;
/** Vertical gap between nodes: room for a two-line label beside a thin one. */
export const GAP = 32;
/** Height per node in the busiest column, before the money is shared out. */
const ROW = 50;
const MIN_HEIGHT = 380;
/** The height a two-line label needs, with air: the same as the gap between nodes. */
export const LABEL_H = GAP;

export interface FlowLayout {
  nodes: LayoutNode[];
  links: LayoutLink[];
  height: number;
  /** The node the first column was stacked against, if it was. */
  trunk: string | null;
  /** Hairlines between stacked sources, drawn across the node bar. */
  seams: { x: number; y: number }[];
  /** The middle of each label, by node key. */
  labelY: Map<string, number>;
}

/** Lays a Flow out at `width`, or null when there is nothing to draw. */
export function layoutFlow(graph: FlowGraph, width: number, gaps?: number[]): FlowLayout | null {
  if (graph.nodes.length === 0 || graph.links.length === 0) return null;
  const columns = new Map<number, N[]>();
  for (const n of graph.nodes) columns.set(n.column, [...(columns.get(n.column) ?? []), n]);
  const last = Math.max(...columns.keys());
  const busiest = Math.max(...[...columns.values()].map((c) => c.length));
  const height = Math.max(MIN_HEIGHT, busiest * ROW);

  try {
    const generator = sankey<N, L>()
      .nodeId((n) => n.key)
      .nodeWidth(NODE_W)
      .nodePadding(GAP)
      .nodeAlign((n) => n.column)
      .nodeSort((a, b) => a.order - b.order)
      .extent([[1, 16], [width - 1, height - 16]]);
    const g = generator({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({ source: l.source, target: l.target, value: l.cents, tone: l.tone })),
    });
    const trunk = stackTrunk(g);
    if (trunk) generator.update(g);

    // Place the columns by the gaps asked for. Links read their ends from
    // the nodes, so moving a node moves its ribbons with it.
    const widths = Array.from({ length: last }, (_, i) => gaps?.[i] ?? 1);
    const total = widths.reduce((a, w) => a + w, 0);
    const span = width - 2 - NODE_W;
    const x = (col: number) => 1 + (span * widths.slice(0, col).reduce((a, w) => a + w, 0)) / total;
    for (const n of g.nodes) {
      n.x0 = x(n.column);
      n.x1 = n.x0 + NODE_W;
    }

    // Where one stacked source meets the next: a hairline seam, cut from
    // whichever of the two is taller so a thin one keeps all of itself.
    const stack = trunk ? g.nodes.filter((n) => n.column === 0).sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0)) : [];
    const tall = (n: LayoutNode) => (n.y1 ?? 0) - (n.y0 ?? 0);
    const seams = stack.slice(1).map((n, i) => ({
      x: n.x0 ?? 0,
      y: (n.y0 ?? 0) + (tall(stack[i]) >= tall(n) ? -0.75 : 0.75),
    }));

    return {
      nodes: g.nodes, links: g.links, height, trunk: trunk?.key ?? null, seams,
      labelY: placeLabels(g.nodes, height),
    };
  } catch {
    return null;
  }
}

/**
 * Stacks the first column flush against the one node it feeds, level with
 * it, when that node is fed by nothing else. Returns that node, or null when
 * the first column is not a trunk. Moves nodes only; the caller recomputes
 * the links' ends.
 */
function stackTrunk(g: SankeyGraph<N, L>): LayoutNode | null {
  const first = g.nodes.filter((n) => n.column === 0).sort((a, b) => a.order - b.order);
  const fed = new Set(g.links.filter((l) => (l.source as LayoutNode).column === 0).map((l) => (l.target as LayoutNode).key));
  if (first.length === 0 || fed.size !== 1) return null;
  const trunk = g.nodes.find((n) => fed.has(n.key));
  if (!trunk || (trunk.targetLinks ?? []).some((l) => (l.source as LayoutNode).column !== 0)) return null;
  let y = trunk.y0 ?? 0;
  for (const n of first) {
    const h = (n.y1 ?? 0) - (n.y0 ?? 0);
    n.y0 = y;
    n.y1 = y + h;
    y += h;
  }
  // Each ribbon arrives where its source sits, so all of them run straight.
  trunk.targetLinks?.sort((a, b) => ((a.source as LayoutNode).y0 ?? 0) - ((b.source as LayoutNode).y0 ?? 0));
  return trunk;
}

/**
 * Where each label's middle goes. A label wants the middle of its node;
 * labels in one column that would overlap are spread apart as a group,
 * centred on where they want to be, and kept inside the drawing.
 */
export function placeLabels(nodes: LayoutNode[], height: number): Map<string, number> {
  const placed = new Map<string, number>();
  const columns = new Map<number, { key: string; want: number }[]>();
  for (const n of nodes) {
    if (!n.label) continue;
    const want = ((n.y0 ?? 0) + (n.y1 ?? 0)) / 2;
    columns.set(n.column, [...(columns.get(n.column) ?? []), { key: n.key, want }]);
  }
  const lo = LABEL_H / 2;
  const hi = height - LABEL_H / 2;
  for (const items of columns.values()) {
    items.sort((a, b) => a.want - b.want);
    type Run = { start: number; members: typeof items };
    const fit = (members: typeof items): Run => {
      const mean = members.reduce((a, m) => a + m.want, 0) / members.length;
      const span = (members.length - 1) * LABEL_H;
      return { members, start: Math.max(lo, Math.min(mean - span / 2, hi - span)) };
    };
    const runs: Run[] = [];
    for (const item of items) {
      let run = fit([item]);
      // Merge with the run above for as long as the two would touch.
      while (runs.length > 0) {
        const prev = runs[runs.length - 1];
        if (prev.start + prev.members.length * LABEL_H <= run.start) break;
        runs.pop();
        run = fit([...prev.members, ...run.members]);
      }
      runs.push(run);
    }
    for (const r of runs) r.members.forEach((m, i) => placed.set(m.key, r.start + i * LABEL_H));
  }
  return placed;
}
