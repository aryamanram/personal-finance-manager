/**
 * Where the Flow's nodes, ribbons and labels go, in pixels, for a given width.
 *
 * Pure — no React, no DOM — so the geometry is tested directly. d3-sankey
 * wires the graph (each node's links and value); the placement is this
 * file's own. The trunk sets the scale: the whole of the money is drawn at
 * one generous height from the top of the chart, and every column hangs from
 * that same top edge, each node beside the band that feeds it. Where thin
 * nodes need room for their labels the chart grows downward, rather than
 * shrinking the trunk to fit — the way Monarch's cash-flow chart reads — and
 * where they sprawl far below it, the trunk grows too, to keep its share.
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
/** The height a two-line label needs, with air: the same as the gap between nodes. */
export const LABEL_H = GAP;
/** Above the first node and below the last: room for a label's halo. */
export const EDGE = 16;
/** How tall the whole of the money is drawn on the main Flow, at least. */
export const TRUNK_HEIGHT = 520;
/** The least of the chart's height the trunk takes, when the rest sprawls below it. */
export const TRUNK_SHARE = 0.6;
/** How far past its usual height the trunk grows to keep that share. */
const TRUNK_GROWTH = 2;

export interface FlowLayout {
  nodes: LayoutNode[];
  links: LayoutLink[];
  height: number;
  /** The node the first column stacks against, when the first column is a trunk. */
  trunk: string | null;
  /** Hairlines between stacked sources, drawn across the node bar. */
  seams: { x: number; y: number }[];
  /** The middle of each label, by node key. */
  labelY: Map<string, number>;
}

export interface LayoutOptions {
  /** The relative width of each gap between columns, left to right; even by default. */
  gaps?: number[];
  /**
   * How tall the whole of the money is drawn, in pixels, at least: it grows,
   * up to twice this, to stay TRUNK_SHARE of the chart's height.
   */
  trunkHeight?: number;
}

/** Lays a Flow out at `width`, or null when there is nothing to draw. */
export function layoutFlow(
  graph: FlowGraph,
  width: number,
  { gaps, trunkHeight = TRUNK_HEIGHT }: LayoutOptions = {},
): FlowLayout | null {
  if (graph.nodes.length === 0 || graph.links.length === 0) return null;

  try {
    // An extent with room to spare: d3's own placement is replaced below.
    const generator = sankey<N, L>()
      .nodeId((n) => n.key)
      .nodeWidth(NODE_W)
      .nodePadding(GAP)
      .nodeAlign((n) => n.column)
      .nodeSort((a, b) => a.order - b.order)
      .extent([[1, EDGE], [width - 1, EDGE + trunkHeight + graph.nodes.length * GAP]]);
    const g = generator({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({ source: l.source, target: l.target, value: l.cents, tone: l.tone })),
    });

    const columns = new Map<number, LayoutNode[]>();
    for (const n of g.nodes) columns.set(n.column, [...(columns.get(n.column) ?? []), n]);
    for (const c of columns.values()) c.sort((a, b) => a.order - b.order);
    const last = Math.max(...columns.keys());
    const fullest = Math.max(...[...columns.values()].map((c) => c.reduce((a, n) => a + (n.value ?? 0), 0)));
    // A node's ribbons leave and arrive in the order of the nodes at their
    // other end, so no two ribbons from one node cross.
    for (const n of g.nodes) {
      n.sourceLinks?.sort((a, b) => (a.target as LayoutNode).order - (b.target as LayoutNode).order);
      n.targetLinks?.sort((a, b) => (a.source as LayoutNode).order - (b.source as LayoutNode).order);
    }
    const trunk = trunkOf(g);

    /**
     * Places every node with the fullest column — the whole of the money —
     * drawn `t` tall, and returns where the lowest node ends. Left to right,
     * so every node's sources are placed before it is; the first column of a
     * trunk stacks flush, every other column keeps the gap.
     */
    let ky = 0;
    const size = (n: LayoutNode) => (n.value ?? 0) * ky;
    const place = (t: number): number => {
      ky = t / fullest;
      for (const l of g.links) l.width = l.value * ky;
      for (const col of [...columns.keys()].sort((a, b) => a - b)) {
        const nodes = columns.get(col)!;
        const tops = pack(
          nodes.map((n) => ({ want: wantOf(n, size(n)), size: size(n) })),
          col === 0 && trunk ? 0 : GAP,
          EDGE,
        );
        nodes.forEach((n, i) => {
          n.y0 = tops[i];
          n.y1 = tops[i] + size(n);
        });
      }
      return Math.max(...g.nodes.map((n) => n.y1 ?? 0));
    };

    // The trunk keeps its share: drawn taller while what hangs below it would
    // dwarf it. Each pass moves toward the height where the trunk is exactly
    // its share, and the chart grows by less than the trunk does, so a few
    // passes settle it.
    let t = trunkHeight;
    let lowest = place(t);
    for (let pass = 0; pass < 12; pass++) {
      const next = Math.min(trunkHeight * TRUNK_GROWTH, Math.max(trunkHeight, TRUNK_SHARE * (lowest - EDGE)));
      if (Math.abs(next - t) < 0.5) break;
      t = next;
      lowest = place(t);
    }
    generator.update(g);

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
    const stack = trunk ? (columns.get(0) ?? []) : [];
    const seams = stack.slice(1).map((n, i) => ({
      x: n.x0 ?? 0,
      y: (n.y0 ?? 0) + (size(stack[i]) >= size(n) ? -0.75 : 0.75),
    }));

    const height = Math.max(EDGE * 2 + t, lowest + EDGE);
    return {
      nodes: g.nodes, links: g.links, height, trunk: trunk?.key ?? null, seams,
      labelY: placeLabels(g.nodes, height),
    };
  } catch {
    return null;
  }
}

/**
 * The node the first column feeds, when it feeds exactly one and that node
 * is fed by nothing else: the trunk the sources stack against.
 */
function trunkOf(g: SankeyGraph<N, L>): LayoutNode | null {
  const fed = new Set(g.links.filter((l) => (l.source as LayoutNode).column === 0).map((l) => (l.target as LayoutNode).key));
  if (fed.size !== 1) return null;
  const trunk = g.nodes.find((n) => fed.has(n.key));
  if (!trunk || (trunk.targetLinks ?? []).some((l) => (l.source as LayoutNode).column !== 0)) return null;
  return trunk;
}

/**
 * Where a node wants its top: level with the middle of the money arriving in
 * it, measured where that money leaves its sources, so its ribbons run as
 * straight as its neighbours allow. A node nothing feeds wants the top.
 */
function wantOf(n: LayoutNode, size: number): number {
  let at = 0;
  let money = 0;
  for (const l of n.targetLinks ?? []) {
    const s = l.source as LayoutNode;
    let y = s.y0 ?? 0;
    for (const o of s.sourceLinks ?? []) {
      if (o === l) break;
      y += o.width ?? 0;
    }
    at += (y + (l.width ?? 0) / 2) * l.value;
    money += l.value;
  }
  return money > 0 ? at / money - size / 2 : EDGE;
}

/**
 * Packs items into a line, in the order given, at least `gap` apart and no
 * higher than `lo` (nor, given `hi`, lower than it): each run of items that
 * would collide moves as one, centred on where its members want to be.
 * Returns each item's top.
 */
export function pack(items: { want: number; size: number }[], gap: number, lo: number, hi = Infinity): number[] {
  type Run = { start: number; span: number; members: number[] };
  const fit = (members: number[]): Run => {
    let offset = 0;
    let sum = 0;
    for (const [k, i] of members.entries()) {
      sum += items[i].want - offset;
      offset += items[i].size + (k < members.length - 1 ? gap : 0);
    }
    const span = offset;
    return { members, span, start: Math.max(lo, Math.min(sum / members.length, hi - span)) };
  };
  const runs: Run[] = [];
  for (let i = 0; i < items.length; i++) {
    let run = fit([i]);
    // Merge with the run above for as long as the two would come too close.
    while (runs.length > 0) {
      const prev = runs[runs.length - 1];
      if (prev.start + prev.span + gap <= run.start) break;
      runs.pop();
      run = fit([...prev.members, ...run.members]);
    }
    runs.push(run);
  }
  const tops: number[] = [];
  for (const r of runs) {
    let y = r.start;
    for (const i of r.members) {
      tops[i] = y;
      y += items[i].size + gap;
    }
  }
  return tops;
}

/**
 * Where each label's middle goes. A label wants the middle of its node;
 * labels in one column that would overlap are spread apart as a group,
 * centred on where they want to be, and kept inside the drawing.
 */
export function placeLabels(nodes: LayoutNode[], height: number): Map<string, number> {
  const placed = new Map<string, number>();
  const columns = new Map<number, { key: string; mid: number }[]>();
  for (const n of nodes) {
    if (!n.label) continue;
    const mid = ((n.y0 ?? 0) + (n.y1 ?? 0)) / 2;
    columns.set(n.column, [...(columns.get(n.column) ?? []), { key: n.key, mid }]);
  }
  for (const items of columns.values()) {
    items.sort((a, b) => a.mid - b.mid);
    const tops = pack(items.map((m) => ({ want: m.mid - LABEL_H / 2, size: LABEL_H })), 0, 0, height);
    items.forEach((m, i) => placed.set(m.key, tops[i] + LABEL_H / 2));
  }
  return placed;
}
