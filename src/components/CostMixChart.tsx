'use client';

import { useId, useState } from 'react';
import { formatCents, formatCentsCompact } from '@/money';
import type { MonthlyCashflow } from '@/lib/types';
import { formatMonthAbbrev, formatMonthLong } from '@/lib/format-date';

/**
 * Fixed vs variable, twelve months. The forecasting axis: fixed costs are the
 * part of next month you already know (INGEST_NOTES.md §5).
 *
 * Hand-written SVG rather than Recharts. Recharts 3.10.1 renders every bar as
 * an empty `recharts-inactive-bar` here — no path, no axis ticks — in dev and
 * in a production build alike, and a minimal fixed-size chart with hardcoded
 * data fails the same way, so it is not this project's data or layout. The
 * Sankey is already hand-written SVG for a similar reason (DESIGN.md §4), so
 * this keeps a page that must not silently render nothing off a dependency
 * that silently rendered nothing.
 *
 * Bar height is the money; nothing else encodes magnitude.
 */

/** Plot geometry, in viewBox units. The SVG scales to its container. */
const W = 960;
const H = 240;
const PAD_L = 56;   // room for the y-axis labels
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 28;   // room for the month labels

const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

/** Share of each slot taken by the bar; the rest is the gap between months. */
const BAR_SHARE = 0.56;
/** A gap so stacked segments never touch, and the boundary stays readable. */
const SEAM = 2;

interface Row {
  month: string;
  full: string;
  fixed: number;
  variable: number;
  total: number;
}

export function CostMixChart({ data }: { data: MonthlyCashflow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();

  const rows: Row[] = data.map((m) => {
    const fixed = Number(m.fixed_cents ?? 0);
    const variable = Number(m.variable_cents ?? 0);
    return {
      month: formatMonthAbbrev(m.month),
      full: formatMonthLong(m.month),
      fixed,
      variable,
      total: fixed + variable,
    };
  });

  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-paper-faint">
        No months to chart yet.
      </p>
    );
  }

  // Round the axis up to a clean step so the gridlines read as round numbers.
  const peak = Math.max(...rows.map((r) => r.total), 1);
  const max = niceCeiling(peak);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  const slot = PLOT_W / rows.length;
  const barW = Math.min(slot * BAR_SHARE, 64);
  const y = (cents: number) => PAD_T + PLOT_H - (cents / max) * PLOT_H;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Fixed and variable spending by month"
      >
        <defs>
          {/* Keeps a rounded bar top from bleeding past the plot on a month
              that reaches the ceiling. */}
          <clipPath id={clipId}>
            <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} />
          </clipPath>
        </defs>

        {/* Gridlines and the value axis. Recessive: they orient, they do not
            compete with the bars. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--color-ink-700)"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 10}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              className="fill-paper-faint"
              style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
            >
              {formatCentsCompact(t)}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {rows.map((r, i) => {
            const cx = PAD_L + slot * i + slot / 2;
            const x = cx - barW / 2;
            const active = hover === null || hover === i;

            // Fixed sits on the bottom: it is the floor you cannot move.
            const fixedH = (r.fixed / max) * PLOT_H;
            const varH = (r.variable / max) * PLOT_H;
            const fixedY = PAD_T + PLOT_H - fixedH;
            const varY = fixedY - varH;

            return (
              <g
                key={r.full}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ opacity: active ? 1 : 0.35 }}
                className="transition-opacity duration-150"
              >
                {/* A full-height hit area, so hovering anywhere in the column
                    works — not only on a short bar. */}
                <rect
                  x={cx - slot / 2}
                  y={PAD_T}
                  width={slot}
                  height={PLOT_H}
                  fill="transparent"
                />
                {r.fixed > 0 && (
                  <rect
                    x={x}
                    y={fixedY}
                    width={barW}
                    height={Math.max(1, fixedH)}
                    fill="var(--color-out)"
                  />
                )}
                {r.variable > 0 && (
                  <rect
                    x={x}
                    y={varY}
                    width={barW}
                    // The seam comes out of the upper segment, so the two
                    // fills never share an edge.
                    height={Math.max(1, varH - (r.fixed > 0 ? SEAM : 0))}
                    fill="var(--color-out-lift)"
                    rx={2}
                  />
                )}
                <title>
                  {`${r.full}\nFixed ${formatCents(r.fixed)}\nVariable ${formatCents(r.variable)}\nTotal ${formatCents(r.total)}`}
                </title>
              </g>
            );
          })}
        </g>

        {/* Baseline, drawn over the bars so they sit on a crisp edge. */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={PAD_T + PLOT_H}
          y2={PAD_T + PLOT_H}
          stroke="var(--color-ink-600)"
          strokeWidth={1}
        />

        {rows.map((r, i) => (
          <text
            key={r.full}
            x={PAD_L + slot * i + slot / 2}
            y={H - 8}
            textAnchor="middle"
            className={hover === i ? 'fill-paper' : 'fill-paper-faint'}
            style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
          >
            {r.month}
          </text>
        ))}
      </svg>

      <figcaption className="mt-3 flex flex-wrap items-center gap-4 text-xs text-paper-dim">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[1px]"
            style={{ background: 'var(--color-out)' }}
          />
          Fixed
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[1px]"
            style={{ background: 'var(--color-out-lift)' }}
          />
          Variable
        </span>
        {hover !== null && rows[hover] && (
          <span className="figure text-paper-faint">
            {rows[hover]!.full} · {formatCents(rows[hover]!.total)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** Rounds up to 1, 2, 2.5 or 5 x a power of ten, so gridlines are round. */
function niceCeiling(n: number): number {
  const mag = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (n <= step * mag) return step * mag;
  }
  return 10 * mag;
}
