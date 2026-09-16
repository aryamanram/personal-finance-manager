'use client';

import { useMemo, useState } from 'react';
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey';
import { formatCentsCompact, formatCents } from '@/money';

/**
 * Income -> necessity -> category. The view the whole project is for.
 *
 * Recharts' Sankey cannot express this (DESIGN.md §4), so this is d3-sankey for
 * layout and hand-written SVG for the marks. Flow width is the money; nothing
 * else in the chart encodes magnitude.
 */

export interface SankeyInput {
  incomeCents: number;
  requiredCents: number;
  discretionaryCents: number;
  investedCents: number;
  categories: { name: string; necessity: string; cents: number }[];
  /** Label for the source node. Defaults to "Income". */
  sourceLabel?: string;
}

interface N { name: string; kind: 'income' | 'bucket' | 'category'; cents: number; tone: string }
interface L { source: number; target: number; value: number; tone: string }

const TONE = {
  in: 'var(--color-in)',
  out: 'var(--color-out)',
  invest: 'var(--color-invest)',
  left: 'var(--color-paper-dim)',
} as const;

const WIDTH = 940;
const HEIGHT = 340;
/**
 * Gutters reserved for the node labels, which sit outside the diagram. The left
 * one is computed from the longest source label actually being drawn — a fixed
 * value fits "Income $13k" and clips "From savings $25k", and the labels vary
 * with the data, so guessing a constant is guessing wrong periodically.
 */
const PAD_RIGHT = 148;
/** Rough advance width per character at the 11px label size, plus the value. */
const CHAR_PX = 6.2;
const LABEL_GAP = 14;
const MIN_PAD_LEFT = 78;
const MAX_CATEGORIES = 5;
/**
 * A flow thinner than this fraction OF TOTAL INCOME cannot be read, so it is
 * folded into one "other" flow. Measuring against the bucket instead of the
 * whole is what produced an unreadable comb of hairlines: every child of a
 * small bucket is a large share of that bucket and a sliver of the diagram.
 */
const MIN_SHARE_OF_TOTAL = 0.02;

/** Renders a balanced cashflow diagram from income through spending categories. */
export function Sankey({ data }: { data: SankeyInput }) {
  const [hover, setHover] = useState<number | null>(null);

  const graph = useMemo(() => {
    const { incomeCents, requiredCents, discretionaryCents, investedCents } = data;

    const spent = requiredCents + discretionaryCents + investedCents;

    // When spending exceeds income the difference came from somewhere —
    // savings, a transfer in, or an existing balance. Naming it keeps the
    // diagram balanced and honest. Refusing to draw at all (the old behaviour
    // whenever income was zero) hid the entire breakdown in exactly the months
    // a person most wants to see where the money went.
    const drawdown = Math.max(0, spent - incomeCents);
    const sourceTotal = incomeCents + drawdown;
    if (sourceTotal <= 0) return null;

    const leftover = Math.max(0, incomeCents - spent);

    // Naming the source node is not cosmetic. When spending outruns income the
    // node's value is income + drawdown, and calling that "Income" contradicts
    // the income figure in the header above it. Split it into two source nodes
    // instead, so both numbers are true and the funding gap is visible.
    const nodes: N[] = [];
    const links: L[] = [];

    const sourceIndexes: number[] = [];
    if (incomeCents > 0) {
      sourceIndexes.push(nodes.length);
      nodes.push({
        name: data.sourceLabel ?? 'Income',
        kind: 'income',
        cents: incomeCents,
        tone: TONE.in,
      });
    }
    if (drawdown > 0) {
      sourceIndexes.push(nodes.length);
      nodes.push({ name: 'From savings', kind: 'income', cents: drawdown, tone: TONE.left });
    }

    const buckets: { name: string; cents: number; tone: string; necessity: string }[] = [
      { name: 'Required', cents: requiredCents, tone: TONE.out, necessity: 'required' },
      { name: 'Discretionary', cents: discretionaryCents, tone: TONE.out, necessity: 'discretionary' },
      { name: 'Invested', cents: investedCents, tone: TONE.invest, necessity: 'investment' },
      { name: 'Unspent', cents: leftover, tone: TONE.left, necessity: 'leftover' },
    ].filter((b) => b.cents > 0);

    // With two sources, fanning each one into every bucket produces a mess of
    // crossing ribbons that encodes nothing — the ledger cannot say which
    // dollar paid for what. Pool them into a single node instead, so the
    // sources stay legible and the flows downstream stay readable.
    let poolIndex = sourceIndexes[0]!;
    if (sourceIndexes.length > 1) {
      poolIndex = nodes.length;
      nodes.push({ name: 'Available', kind: 'bucket', cents: sourceTotal, tone: TONE.left });
      for (const si of sourceIndexes) {
        links.push({ source: si, target: poolIndex, value: nodes[si].cents, tone: nodes[si].tone });
      }
    }

    const bucketIndex = new Map<string, number>();
    for (const b of buckets) {
      const i = nodes.length;
      nodes.push({ name: b.name, kind: 'bucket', cents: b.cents, tone: b.tone });
      bucketIndex.set(b.necessity, i);
      links.push({ source: poolIndex, target: i, value: b.cents, tone: b.tone });
    }

    // Callers may pass the same category more than once — the breakdown query
    // groups by cost_type as well, so Entertainment arrives split into its
    // fixed and variable halves. This diagram is about WHERE money went, not
    // how predictable it was, so fold those back together first. Without this,
    // one category renders as two nodes with the same name.
    const merged = new Map<string, { name: string; necessity: string; cents: number }>();
    for (const c of data.categories) {
      if (c.cents <= 0) continue;
      const key = `${c.necessity}|${c.name}`;
      const existing = merged.get(key);
      if (existing) existing.cents += c.cents;
      else merged.set(key, { ...c });
    }

    // Top categories only; the tail becomes one "Other" flow so the chart
    // stays readable without hiding money.
    const byNecessity = new Map<string, { name: string; necessity: string; cents: number }[]>();
    for (const c of merged.values()) {
      const g = byNecessity.get(c.necessity);
      if (g) g.push(c);
      else byNecessity.set(c.necessity, [c]);
    }

    for (const [necessity, cats] of byNecessity) {
      const parent = bucketIndex.get(necessity);
      if (parent === undefined) continue;

      const sorted = [...cats].sort((a, b) => b.cents - a.cents);
      // Keep the big ones; fold everything too thin to render into one flow, so
      // no money is hidden but no hairline is unreadable.
      const keep = sorted.filter(
        (c, i) => i < MAX_CATEGORIES && c.cents / sourceTotal >= MIN_SHARE_OF_TOTAL,
      );
      const shown = keep.length > 0 ? keep : sorted.slice(0, 1);
      const rest = sorted.slice(shown.length);

      for (const c of shown) {
        const i = nodes.length;
        nodes.push({ name: c.name, kind: 'category', cents: c.cents, tone: nodes[parent].tone });
        links.push({ source: parent, target: i, value: c.cents, tone: nodes[parent].tone });
      }
      if (rest.length > 0) {
        const total = rest.reduce((a, c) => a + c.cents, 0);
        const i = nodes.length;
        // Name it by its parent. Two bare "N more" nodes stacked next to each
        // other are indistinguishable, which defeats the point of folding.
        const label = `${rest.length} more ${nodes[parent].name.toLowerCase()}`;
        nodes.push({ name: label, kind: 'category', cents: total, tone: nodes[parent].tone });
        links.push({ source: parent, target: i, value: total, tone: nodes[parent].tone });
      }
    }

    if (links.length === 0) return null;

    // "Income $13k" vs "From savings $25k" — size the gutter to whichever is
    // actually being drawn.
    const padLeft = Math.max(
      MIN_PAD_LEFT,
      ...sourceIndexes.map((i) =>
        (nodes[i]!.name.length + formatCentsCompact(nodes[i]!.cents).length + 2) * CHAR_PX
        + LABEL_GAP),
    );

    try {
      return sankey<N, L>()
        .nodeWidth(11)
        .nodePadding(12)
        .nodeAlign(sankeyJustify)
        .extent([[padLeft, 6], [WIDTH - PAD_RIGHT, HEIGHT - 6]])({
          nodes: nodes.map((n) => ({ ...n })),
          links: links.map((l) => ({ ...l })),
        });
    } catch {
      return null;
    }
  }, [data]);

  if (!graph) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-paper-faint">
        No money moved in this period.
      </div>
    );
  }

  const path = sankeyLinkHorizontal<N, L>();

  return (
    <figure className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-[720px]"
        role="img"
        aria-label="Where income went this month"
      >
        <g>
          {graph.links.map((link, i) => {
            const active = hover === null || hover === i;
            return (
              <path
                key={i}
                d={path(link) ?? undefined}
                fill="none"
                stroke={link.tone}
                strokeWidth={Math.max(1, link.width ?? 1)}
                strokeOpacity={active ? 0.28 : 0.08}
                className="transition-[stroke-opacity] duration-150"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {(link.source as unknown as N).name} → {(link.target as unknown as N).name}
                  {'  '}
                  {formatCents(link.value)}
                </title>
              </path>
            );
          })}
        </g>

        <g>
          {graph.nodes.map((node, i) => {
            const x0 = node.x0 ?? 0;
            const x1 = node.x1 ?? 0;
            const y0 = node.y0 ?? 0;
            const y1 = node.y1 ?? 0;
            const height = Math.max(1, y1 - y0);
            // Income labels to the left of its node (it owns the left gutter);
            // everything else labels to the right, into the right gutter.
            const toLeft = node.kind === 'income';

            return (
              <g key={i}>
                <rect
                  x={x0}
                  y={y0}
                  width={Math.max(1, x1 - x0)}
                  height={height}
                  fill={node.tone}
                  fillOpacity={0.85}
                  rx={1}
                />
                {(
                  <text
                    x={toLeft ? x0 - 8 : x1 + 8}
                    y={y0 + height / 2}
                    dy="0.34em"
                    textAnchor={toLeft ? 'end' : 'start'}
                    className="fill-paper-dim"
                    style={{ fontSize: 11 }}
                  >
                    {node.name}
                    <tspan
                      className="fill-paper-faint"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                    >
                      {'  '}{formatCentsCompact(node.cents)}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </figure>
  );
}
