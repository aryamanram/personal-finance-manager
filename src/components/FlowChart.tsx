'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { sankeyLinkHorizontal } from 'd3-sankey';
import { formatCents } from '@/money';
import { formatShare } from '@/lib/share';
import type { FlowGraph, GraphNode, Tone } from '@/lib/flow';
import { layoutFlow, NODE_W, type LayoutLink, type LayoutNode } from '@/lib/flow-layout';

/**
 * Draws a Flow: the main one on the Flow page, or a category's own.
 *
 * d3-sankey lays it out and the marks are hand-written SVG (DESIGN.md §4).
 * Ribbon width is the money and nothing else encodes magnitude. Each ribbon
 * fades from the colour of the node it leaves to the colour of the node it
 * reaches, so money visibly turns into what it became; colour is never the
 * only cue — every node is labelled with its exact amount and share, and the
 * page has a table of the same numbers.
 *
 * The first column is a trunk: when it all feeds one node, it stacks flush
 * against that node, as tall as it and level with it, so the money arrives
 * as one block — separate where it starts, one stream where it lands — and
 * visibly splits from there.
 *
 * Labels sit inside the drawing, on the side of each node its money arrives
 * from: the first column and the junction label to their right, every other
 * column to its left, over its own incoming ribbon. Laid out in real pixels
 * at the width it is given, so the type is the page's own size at every width.
 */

type N = GraphNode;
type SN = LayoutNode;
type SL = LayoutLink;

/** Below this the chart scrolls sideways rather than squeezing its labels. */
export const MIN_WIDTH = 880;
const LABEL_GAP = 10;
const LINE = 8;

/** The colour a tone paints, as CSS. */
function paint(t: Tone, hatch: string): string {
  if (t.kind === 'group') return t.color ?? (t.slot ? `var(--color-group-${t.slot})` : 'var(--color-chart-strong)');
  if (t.kind === 'hatch') return `url(#${hatch})`;
  return t.kind === 'strong' ? 'var(--color-chart-strong)' : 'var(--color-chart-mid)';
}

/** The second line of a label: the amount, and its share when it is a part. */
function amountLine(n: N): { amount: string; share: string | null } {
  const share = n.share !== undefined && n.share < 0.9995 ? formatShare(n.share) : null;
  return { amount: formatCents(n.cents), share };
}

function labelWidth(n: N): number {
  if (!n.label) return 0;
  const { amount, share } = amountLine(n);
  return Math.max(n.label.length * 6.9, (amount.length + (share ? share.length + 3 : 0)) * 7.4) + 6;
}

const labelsRight = (n: N) => n.column === 0 || n.kind === 'junction';

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
  const uid = useId().replace(/:/g, '');
  const hatch = `hatch-${uid}`;
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

  const layout = useMemo(() => layoutFlow(graph, width, gaps), [graph, width, gaps]);

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

  const path = sankeyLinkHorizontal<N, LayoutLink>();
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
              A texture rather than a hue, so it reads in either theme and
              never competes with the groups. */}
          <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={6} height={6} style={{ fill: 'var(--chart-surface, var(--color-ground))' }} />
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--color-chart-mid)" strokeWidth={1.25} />
          </pattern>
          {layout.links.map((l, i) => {
            const s = l.source as SN;
            const t = l.target as SN;
            const state = !lit ? 'rest' : lit.links.has(l) ? 'lit' : 'dim';
            const opacity = (tone: Tone) => {
              const neutral = tone.kind !== 'group';
              if (state === 'dim') return '0.06';
              if (state === 'lit') return neutral ? 'var(--ribbon-neutral-lit)' : 'var(--ribbon-lit)';
              return neutral ? 'var(--ribbon-neutral)' : 'var(--ribbon)';
            };
            // A hatched end has no colour to fade from: the solid end's
            // colour fades to nothing there, and the hatch, drawn over it,
            // fades the other way — savings dissolving into the stream, or
            // the stream into savings.
            const sHatch = s.tone.kind === 'hatch';
            const tHatch = t.tone.kind === 'hatch';
            const from = sHatch ? t.tone : s.tone;
            const to = tHatch ? s.tone : t.tone;
            return (
              <g key={i}>
                <linearGradient id={`${uid}-r${i}`} gradientUnits="userSpaceOnUse" x1={s.x1} x2={t.x0}>
                  <stop offset="0%" style={{ stopColor: paint(from, hatch), stopOpacity: sHatch ? 0 : opacity(from) }} />
                  <stop offset="100%" style={{ stopColor: paint(to, hatch), stopOpacity: tHatch ? 0 : opacity(to) }} />
                </linearGradient>
                {(sHatch || tHatch) && (
                  <>
                    <linearGradient id={`${uid}-f${i}`} gradientUnits="userSpaceOnUse" x1={s.x1} x2={t.x0}>
                      <stop offset="10%" stopColor="#fff" stopOpacity={sHatch ? 1 : 0} />
                      <stop offset="90%" stopColor="#fff" stopOpacity={tHatch ? 1 : 0} />
                    </linearGradient>
                    {/* In the drawing's own units: a straight ribbon has no
                        height to measure a mask against. */}
                    <mask id={`${uid}-m${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={layout.height}>
                      <rect width={width} height={layout.height} fill={`url(#${uid}-f${i})`} />
                    </mask>
                  </>
                )}
              </g>
            );
          })}
        </defs>

        <g fill="none">
          {layout.links.map((l, i) => {
            const w = Math.max(1, l.width ?? 1);
            const d = path(l) ?? undefined;
            const enter = () => setActive((l.target as SN).key);
            const hatched = (l.source as SN).tone.kind === 'hatch' || (l.target as SN).tone.kind === 'hatch';
            return (
              <g key={i} onMouseEnter={enter}>
                <path d={d} stroke={`url(#${uid}-r${i})`} strokeWidth={w} />
                {hatched && (
                  <path
                    d={d}
                    stroke={`url(#${hatch})`}
                    strokeWidth={w}
                    mask={`url(#${uid}-m${i})`}
                    style={{ strokeOpacity: lit && !lit.links.has(l) ? 0.12 : 0.55 }}
                  />
                )}
              </g>
            );
          })}
        </g>

        <g>
          {layout.nodes.map((n) => {
            const x0 = n.x0 ?? 0;
            const x1 = n.x1 ?? 0;
            const y0 = n.y0 ?? 0;
            const h = Math.max(2, (n.y1 ?? 0) - y0);
            const right = labelsRight(n);
            const dim = lit && !lit.nodes.has(n.key);
            const interactive = !!n.action;
            const { amount, share } = amountLine(n);
            const lw = n.label ? labelWidth(n) + LABEL_GAP : 0;
            const cy = layout.labelY.get(n.key) ?? y0 + h / 2;
            const tx = right ? x1 + LABEL_GAP : x0 - LABEL_GAP;
            const top = Math.min(y0, cy - 18);
            return (
              <g
                key={n.key}
                role={interactive ? 'button' : 'img'}
                tabIndex={0}
                aria-label={describe(n)}
                onMouseEnter={() => setActive(n.key)}
                onFocus={() => setActive(n.key)}
                onBlur={() => setActive(null)}
                onClick={() => act(n)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(n); }
                  if (e.key === 'Escape') setActive(null);
                }}
                className={clsx('flow-node outline-none transition-opacity duration-150', interactive && 'cursor-pointer')}
                style={{ opacity: dim ? 0.3 : 1 }}
              >
                {/* A hit area as wide as the label and taller than a thin
                    node, so a $4 category is still something to point at. */}
                <rect
                  x={right ? x0 - 4 : x0 - lw - 4}
                  y={top}
                  width={x1 - x0 + lw + 8}
                  height={Math.max(y0 + h, cy + 18) - top}
                  fill="transparent"
                />
                <rect x={x0} y={y0} width={x1 - x0} height={h} rx={3} style={{ fill: paint(n.tone, hatch) }} />
                {n.tone.kind === 'hatch' && (
                  <rect x={x0 + 0.5} y={y0 + 0.5} width={x1 - x0 - 1} height={Math.max(0, h - 1)} rx={3}
                    fill="none" stroke="var(--color-chart-mid)" />
                )}
                {/* Drawn as a ring when focused: the default focus outline
                    does not follow an SVG group's shape. */}
                <rect className="flow-focus" x={x0 - 3} y={y0 - 3} width={x1 - x0 + 6} height={h + 6}
                  fill="none" stroke="var(--color-ink)" strokeWidth={1.5} rx={5} />
                {n.label && (
                  <text y={cy} textAnchor={right ? 'start' : 'end'} className="flow-label figure-display">
                    <tspan x={tx} dy={-LINE + 3.5}
                      className={n.kind === 'more' ? 'fill-ink-faint' : 'fill-ink-dim'}
                      style={{ fontSize: 12.5, fontWeight: 500 }}>
                      {n.label}
                    </tspan>
                    <tspan x={tx} dy={LINE * 2 - 1} className="fill-ink" style={{ fontSize: 13, fontWeight: 600 }}>
                      {amount}
                      {share && (
                        <tspan className="fill-ink-faint" style={{ fontWeight: 400 }}>{` (${share})`}</tspan>
                      )}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
          {layout.seams.map((s) => (
            <line key={s.y} x1={s.x} x2={s.x + NODE_W} y1={s.y} y2={s.y}
              stroke="var(--chart-surface, var(--color-ground))" strokeWidth={1.5} pointerEvents="none" />
          ))}
        </g>
      </svg>

      {activeNode && (
        <Tooltip node={activeNode} width={width} hatch={hatch} />
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
  if (n.kind === 'junction') return 'Everything this period had: what came in, and anything drawn from savings';
  if (n.key === 'bucket:leftover') return 'What came in and was not spent or invested';
  if (n.key === 'source:savings') return 'Spent beyond what came in this period';
  return null;
}

function Tooltip({ node, width, hatch }: { node: SN; width: number; hatch: string }) {
  const x1 = node.x1 ?? 0;
  const x0 = node.x0 ?? 0;
  const y0 = node.y0 ?? 0;
  const W = 232;
  // Beside the node, on the side its label is not, and inside the chart.
  const labelSide = labelsRight(node) ? 'right' : 'left';
  const want = labelSide === 'left' ? x1 + 14 : x1 + 14 + labelWidth(node) + LABEL_GAP;
  const left = want + W < width ? want : Math.max(0, x0 - W - 14 - (labelSide === 'left' ? labelWidth(node) + LABEL_GAP : 0));
  const share = node.share !== undefined && node.share < 0.9995 ? formatShare(node.share) : null;
  const shareOf = node.kind === 'source' || node.kind === 'bucket' ? 'of everything this period' : 'of spending';
  const tip = hint(node);

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-xl bg-card px-3.5 py-3 text-xs shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_12px_32px_-8px_rgb(0_0_0/0.25)]"
      style={{ left, top: Math.max(0, y0 - 6), width: W }}
    >
      <div className="flex items-center gap-2 font-medium text-ink">
        {node.tone.kind !== 'hatch' && (
          <span aria-hidden className="swatch" style={{ background: paint(node.tone, hatch) }} />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      <div className="figure-display mt-1.5 text-lg font-semibold text-ink">{formatCents(node.cents)}</div>
      <div className="mt-0.5 space-y-0.5 text-ink-faint">
        {share && <div>{share} {shareOf}</div>}
        {node.txnCount ? <div>{node.txnCount} {node.txnCount === 1 ? 'transaction' : 'transactions'}</div> : null}
        {node.creditCents ? <div>{formatCents(node.creditCents)} came back, shown as Credits</div> : null}
      </div>
      {tip && <div className="mt-2 border-t border-rule pt-2 text-ink-dim">{tip}</div>}
    </div>
  );
}
