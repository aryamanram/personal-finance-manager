'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { sankey, sankeyLinkHorizontal, type SankeyNode, type SankeyLink } from 'd3-sankey';
import { formatCents } from '@/money';
import type { FlowGraph, GraphNode, Tone } from '@/lib/flow';

/**
 * Draws a Flow: the main one on the Flow page, or a category's own.
 *
 * d3-sankey lays it out and the marks are hand-written SVG (DESIGN.md §4).
 * Ribbon width is the money and nothing else encodes magnitude. Colour says
 * what kind of thing the money became — the category's group — and is never
 * the only cue: every node is labelled with its exact amount, touching
 * ribbons are parted by a seam, and the page has a table of the same numbers.
 *
 * Laid out in real pixels at the width it is given, rather than scaled from a
 * fixed viewBox, so labels are the page's own type size at every width.
 */

type N = GraphNode;
type L = { source: string; target: string; value: number; tone: Tone };
type SN = SankeyNode<N, L>;
type SL = SankeyLink<N, L>;

const NODE_W = 10;
/** Vertical gap between nodes; at least a label's line, so labels never touch. */
const GAP = 16;
/** Height per node in the busiest column, before the money is shared out. */
const ROW = 30;
const MIN_HEIGHT = 300;
/** Below this the chart scrolls sideways rather than squeezing its labels. */
export const MIN_WIDTH = 880;
const LABEL_GAP = 8;
/** Advance widths at the label sizes: 12px Inter Tight, 11px JetBrains Mono. */
const NAME_PX = 6.5;
const FIGURE_PX = 6.7;

function labelWidth(n: N): number {
  if (!n.label) return 0;
  return n.label.length * NAME_PX + formatCents(n.cents).length * FIGURE_PX + 10;
}

function fill(t: Tone, hatch: string): string {
  if (t.kind === 'group') return t.slot ? `var(--color-group-${t.slot})` : 'var(--color-chart-strong)';
  if (t.kind === 'hatch') return `url(#${hatch})`;
  return t.kind === 'strong' ? 'var(--color-chart-strong)' : 'var(--color-chart-mid)';
}

/**
 * A ribbon's opacity, resting and lit, from globals.css (it differs by theme).
 * Neutral ribbons recede so the colour is where the spending is.
 */
const OPACITY = {
  group: ['var(--ribbon)', 'var(--ribbon-lit)'],
  neutral: ['var(--ribbon-neutral)', 'var(--ribbon-neutral-lit)'],
  dim: '0.07',
} as const;

/** Labels left of the node: the first column, and the buckets, whose left is calm grey. */
const labelsLeft = (n: N) => n.column === 0 || n.kind === 'bucket';

export function FlowChart({
  graph,
  label,
  gaps,
  onFocusCategory,
  onExpand,
}: {
  graph: FlowGraph;
  /** What the chart shows, for screen readers: "Where September's money went". */
  label: string;
  /**
   * The relative width of each gap between columns, left to right. Even by
   * default; the main Flow gives the neutral columns less room and the
   * colours more.
   */
  gaps?: number[];
  onFocusCategory?: (id: string) => void;
  onExpand?: (key: string) => void;
}) {
  const router = useRouter();
  const hatch = `hatch-${useId().replace(/:/g, '')}`;
  const box = useRef<HTMLDivElement>(null);
  // The server has no width to measure, so both sides start here and the
  // client corrects it after hydration — never a mismatch, at worst a reflow.
  const [width, setWidth] = useState(1200);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.max(MIN_WIDTH, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (graph.nodes.length === 0 || graph.links.length === 0) return null;
    const columns = new Map<number, N[]>();
    for (const n of graph.nodes) columns.set(n.column, [...(columns.get(n.column) ?? []), n]);
    const last = Math.max(...columns.keys());
    const busiest = Math.max(...[...columns.values()].map((c) => c.length));
    const height = Math.max(MIN_HEIGHT, busiest * ROW);

    // Gutters for the labels outside the diagram: the first column labels to
    // its left, the last to its right. Sized to the labels actually drawn.
    const padLeft = Math.max(60, ...(columns.get(0) ?? []).filter(labelsLeft).map(labelWidth)) + LABEL_GAP + 4;
    const padRight = Math.max(60, ...(columns.get(last) ?? []).map(labelWidth)) + LABEL_GAP + 4;

    try {
      const g = sankey<N, L>()
        .nodeId((n) => n.key)
        .nodeWidth(NODE_W)
        .nodePadding(GAP)
        .nodeAlign((n) => n.column)
        .nodeSort((a, b) => a.order - b.order)
        .extent([[padLeft, 6], [width - padRight, height - 6]])({
          nodes: graph.nodes.map((n) => ({ ...n })),
          links: graph.links.map((l) => ({ source: l.source, target: l.target, value: l.cents, tone: l.tone })),
        });
      // Place the columns by the gaps asked for. Links read their ends from
      // the nodes, so moving a node moves its ribbons with it.
      const widths = Array.from({ length: last }, (_, i) => gaps?.[i] ?? 1);
      const total = widths.reduce((a, w) => a + w, 0);
      const span = width - padRight - padLeft - NODE_W;
      const x = (col: number) => padLeft + (span * widths.slice(0, col).reduce((a, w) => a + w, 0)) / total;
      for (const n of g.nodes) {
        n.x0 = x(n.column);
        n.x1 = n.x0 + NODE_W;
      }
      return { ...g, height, last };
    } catch {
      return null;
    }
  }, [graph, width, gaps]);

  /** Everything upstream and downstream of the active node: its whole path. */
  const lit = useMemo(() => {
    if (!active || !layout) return null;
    const nodes = new Set<string>([active]);
    const links = new Set<SL>();
    const walk = (key: string, dir: 'up' | 'down') => {
      for (const l of layout.links) {
        const s = (l.source as SN).key;
        const t = (l.target as SN).key;
        if (dir === 'up' && t === key && !links.has(l)) { links.add(l); nodes.add(s); walk(s, 'up'); }
        if (dir === 'down' && s === key && !links.has(l)) { links.add(l); nodes.add(t); walk(t, 'down'); }
      }
    };
    walk(active, 'up');
    walk(active, 'down');
    return { nodes, links };
  }, [active, layout]);

  if (!layout) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-ink-faint">
        No money moved in this period.
      </div>
    );
  }

  const path = sankeyLinkHorizontal<N, L>();
  const activeNode = active ? (layout.nodes.find((n) => n.key === active) ?? null) : null;

  const act = (n: N) => {
    const a = n.action;
    if (!a) return;
    if (a.type === 'focus') onFocusCategory?.(a.id);
    else if (a.type === 'expand') onExpand?.(a.key);
    else router.push(a.href);
  };

  return (
    // Focusable, so a keyboard can scroll it when it is wider than the screen.
    <div
      ref={box}
      className="relative w-full overflow-x-auto overflow-y-hidden"
      tabIndex={0}
      role="region"
      aria-label={`${label} — chart`}
    >
      <svg
        width={width}
        height={layout.height}
        className="flow-reveal block"
        role="group"
        aria-label={label}
        onMouseLeave={() => setActive(null)}
      >
        <defs>
          {/* Savings, in either direction: money that was not this period's.
              A texture rather than a hue, so it reads in any theme and in
              print, and never competes with the groups. */}
          <pattern id={hatch} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={5} height={5} fill="var(--color-ground)" />
            <line x1={0} y1={0} x2={0} y2={5} stroke="var(--color-chart-mid)" strokeWidth={2.2} />
          </pattern>
        </defs>

        <g fill="none">
          {layout.links.map((l, i) => {
            const t = l.tone;
            const [rest, on] = t.kind === 'group' ? OPACITY.group : OPACITY.neutral;
            const opacity = !lit ? rest : lit.links.has(l) ? on : OPACITY.dim;
            const w = Math.max(1, l.width ?? 1);
            const d = path(l) ?? undefined;
            return (
              <g key={i}>
                {/* The seam: a ground-coloured ribbon a little wider than the
                    real one, so touching ribbons are always parted, whatever
                    their colours. */}
                <path d={d} stroke="var(--color-ground)" strokeWidth={w + 1.5} />
                <path
                  d={d}
                  stroke={fill(t, hatch)}
                  strokeWidth={w}
                  style={{ strokeOpacity: opacity }}
                  className="transition-[stroke-opacity] duration-150"
                  onMouseEnter={() => setActive((l.target as SN).key)}
                />
              </g>
            );
          })}
        </g>

        <g>
          {layout.nodes.map((n) => {
            const x0 = n.x0 ?? 0;
            const x1 = n.x1 ?? 0;
            const y0 = n.y0 ?? 0;
            const h = Math.max(1, (n.y1 ?? 0) - y0);
            const left = labelsLeft(n);
            const dim = lit && !lit.nodes.has(n.key);
            const interactive = !!n.action;
            const description = describe(n);
            return (
              <g
                key={n.key}
                role={n.kind === 'junction' ? undefined : interactive ? 'button' : 'img'}
                tabIndex={n.kind === 'junction' ? undefined : 0}
                aria-label={n.kind === 'junction' ? undefined : description}
                onMouseEnter={() => setActive(n.key)}
                onFocus={() => setActive(n.key)}
                onBlur={() => setActive(null)}
                onClick={() => act(n)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(n); }
                  if (e.key === 'Escape') setActive(null);
                }}
                className={clsx('outline-none', interactive && 'cursor-pointer', 'flow-node')}
                style={{ opacity: dim ? 0.35 : 1 }}
              >
                {/* A hit area taller than a thin node and as wide as its
                    label, so a $4 category is still something you can point
                    at, and the gap inside a label is not a miss. */}
                {(() => {
                  const lw = n.label ? labelWidth(n) + LABEL_GAP : 0;
                  const hx = left ? x0 - lw - 4 : x0 - 4;
                  const hy = h >= 18 ? y0 : y0 + h / 2 - 9;
                  return <rect x={hx} y={hy} width={x1 - x0 + lw + 8} height={Math.max(18, h)} fill="transparent" />;
                })()}
                <rect x={x0} y={y0} width={x1 - x0} height={h} fill={fill(n.tone, hatch)} rx={1.5} />
                {n.tone.kind === 'hatch' && (
                  <rect x={x0 + 0.5} y={y0 + 0.5} width={x1 - x0 - 1} height={Math.max(0, h - 1)} fill="none"
                    stroke="var(--color-chart-mid)" rx={1.5} />
                )}
                {/* Drawn as a ring when focused: the default focus outline
                    does not follow an SVG group's shape. */}
                <rect className="flow-focus" x={x0 - 3} y={y0 - 3} width={x1 - x0 + 6} height={h + 6}
                  fill="none" stroke="var(--color-ink)" strokeWidth={1.5} rx={3} />
                {n.label && (
                  <text
                    x={left ? x0 - LABEL_GAP : x1 + LABEL_GAP}
                    y={y0 + h / 2}
                    dy="0.35em"
                    textAnchor={left ? 'end' : 'start'}
                    className="flow-label"
                    style={{ fontSize: 12 }}
                  >
                    <tspan className={n.kind === 'more' ? 'fill-ink-dim' : 'fill-ink'}
                      style={{ fontWeight: n.kind === 'bucket' || n.kind === 'source' ? 500 : 400 }}>
                      {n.label}
                    </tspan>
                    <tspan className="fill-ink-faint" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {'  '}{formatCents(n.cents)}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {activeNode && activeNode.kind !== 'junction' && (
        <Tooltip node={activeNode} width={width} />
      )}
    </div>
  );
}

/** A node in words: its name, amount, share and count, and what a click does. */
function describe(n: N): string {
  const parts = [n.name, formatCents(n.cents)];
  if (n.txnCount) parts.push(`${n.txnCount} ${n.txnCount === 1 ? 'transaction' : 'transactions'}`);
  const a = n.action;
  if (a?.type === 'focus') parts.push('look inside');
  else if (a?.type === 'expand') parts.push('show them');
  else if (a?.type === 'rows') parts.push('open its transactions');
  return parts.join(', ');
}

function hint(n: N): string | null {
  const a = n.action;
  if (a?.type === 'focus') return 'Click to look inside';
  if (a?.type === 'expand') return 'Click to show every one';
  if (a?.type === 'rows') return 'Click for its transactions';
  if (n.key === 'bucket:leftover') return 'What came in and was not spent or invested';
  if (n.key === 'source:savings') return 'Spent beyond what came in this period';
  return null;
}

function Tooltip({ node, width }: { node: SN; width: number }) {
  const x1 = node.x1 ?? 0;
  const x0 = node.x0 ?? 0;
  const y0 = node.y0 ?? 0;
  // Beside the node, on whichever side has room; never over its own label.
  const right = x1 + 220 < width && node.column !== 0;
  const style = right
    ? { left: x1 + 12, top: Math.max(0, y0 - 6) }
    : { left: Math.max(0, x0 - 232), top: Math.max(0, y0 - 6) };
  const share = node.share !== undefined && node.share < 1
    ? `${(node.share * 100).toFixed(1)}%` : null;
  const shareOf = node.kind === 'source' || node.kind === 'bucket' ? 'of everything this period' : 'of spending';
  const tip = hint(node);

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-[220px] rounded-sm border border-rule bg-raised px-3 py-2.5 text-xs shadow-lg shadow-black/10"
      style={style}
    >
      <div className="flex items-center gap-2 font-medium text-ink">
        {node.tone.kind === 'group' && (
          <span aria-hidden className="swatch" style={{ background: fill(node.tone, '') }} />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      <div className="figure mt-1 text-sm text-ink">{formatCents(node.cents)}</div>
      <div className="mt-1 space-y-0.5 text-ink-faint">
        {share && <div>{share} {shareOf}</div>}
        {node.txnCount ? <div>{node.txnCount} {node.txnCount === 1 ? 'transaction' : 'transactions'}</div> : null}
        {node.creditCents ? <div>{formatCents(node.creditCents)} came back, shown as Credits</div> : null}
      </div>
      {tip && <div className="mt-2 border-t border-rule pt-1.5 text-ink-dim">{tip}</div>}
    </div>
  );
}
