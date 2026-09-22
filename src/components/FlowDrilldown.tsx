'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Figure } from './Figure';
import type { CategoryBreakdownRow } from '@/lib/queries';

/**
 * What sits under one band of the Sankey (wireframe 43:2).
 *
 * The diagram above answers "how much went to Discretionary"; this answers
 * "which categories, and is it one of them or all of them". Bar length is the
 * share of the selected bucket, not of income — the question here is how this
 * bucket divides, and measuring against income makes every bar in a small
 * bucket a stub.
 *
 * Only buckets that have categories underneath get a toggle. Investment
 * contributions are excluded from `counts_as_spending`, so an Investing pane
 * would always be empty; the diagram still draws the band.
 */

const BUCKETS = [
  { key: 'required', label: 'Required', tone: 'var(--color-flow-required)' },
  { key: 'discretionary', label: 'Discretionary', tone: 'var(--color-flow-discretionary)' },
] as const;

type BucketKey = (typeof BUCKETS)[number]['key'];

export function FlowDrilldown({
  breakdown,
  from,
  to,
}: {
  breakdown: CategoryBreakdownRow[];
  from: string;
  to: string;
}) {
  const available = useMemo(
    () => BUCKETS.filter((b) => breakdown.some((r) => r.necessity === b.key)),
    [breakdown],
  );
  const [selected, setSelected] = useState<BucketKey | null>(null);

  // Open on whichever bucket carries the most money, so a month with little
  // discretionary spending does not open on a nearly empty pane.
  const heaviest = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of breakdown) {
      totals.set(r.necessity, (totals.get(r.necessity) ?? 0) + r.total_cents);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [breakdown]);

  const active =
    available.find((b) => b.key === selected) ??
    available.find((b) => b.key === heaviest) ??
    available[0];

  if (!active) return null;

  const rows = breakdown
    .filter((r) => r.necessity === active.key)
    .sort((a, b) => b.total_cents - a.total_cents);

  const total = rows.reduce((sum, r) => sum + r.total_cents, 0);
  const largest = rows[0]?.total_cents ?? 0;

  return (
    <section>
      <div className="rule-b flex flex-wrap items-center gap-x-5 gap-y-2 pb-3">
        {available.map((b) => {
          const on = b.key === active.key;
          return (
            <button
              key={b.key}
              onClick={() => setSelected(b.key)}
              aria-pressed={on}
              className={clsx(
                'eyebrow transition-colors',
                on ? 'text-paper' : 'hover:text-paper-dim',
              )}
            >
              <span
                aria-hidden
                className="mr-1.5 inline-block h-2 w-2 rounded-[1px] align-middle"
                style={{ background: b.tone, opacity: on ? 1 : 0.35 }}
              />
              {b.label}
            </button>
          );
        })}
        {available.length > 1 && (
          <span className="eyebrow text-paper-faint">· pick one</span>
        )}
      </div>

      <p className="mt-3 text-xs text-paper-faint">
        {rows.length === 1
          ? 'One category carries all of it.'
          : `${rows.length} categories carry ${money(total)}.`}{' '}
        {concentration(rows, total)}
      </p>

      <ul className="mt-5">
        {rows.map((r) => (
          <li
            key={r.category_id ?? r.category_name}
            className="rule-b grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)_100px_110px]"
          >
            <Link
              href={
                r.category_id
                  ? `/transactions?category=${r.category_id}&from=${from}&to=${to}`
                  : `/transactions?uncategorized=1&from=${from}&to=${to}`
              }
              className="truncate text-sm text-paper-dim transition-colors hover:text-paper"
            >
              {r.category_name}
            </Link>

            {/* The bar is hidden on narrow screens, where the figure alone
                carries the comparison. */}
            <div className="hidden h-[6px] rounded-[1px] bg-ink-700 sm:block" aria-hidden>
              <div
                className="h-full rounded-[1px]"
                style={{
                  width: largest > 0 ? `${(r.total_cents / largest) * 100}%` : '0%',
                  background: active.tone,
                }}
              />
            </div>

            <Figure
              cents={r.total_cents}
              tone="neutral"
              showCents={false}
              className="text-right text-sm"
            />
            <span className="hidden text-right text-xs text-paper-faint sm:block">
              {r.txn_count} {r.txn_count === 1 ? 'transaction' : 'transactions'}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-paper-faint">
        Each row opens the register filtered to that category and period.
      </p>
    </section>
  );
}

/**
 * Names the shape of the distribution rather than restating the rows. "Three
 * carry most of it" is the sentence the wireframe asks for, but only when it
 * is true — so it is computed, not asserted.
 */
function concentration(rows: CategoryBreakdownRow[], total: number): string {
  if (rows.length < 3 || total <= 0) return '';
  let running = 0;
  for (let i = 0; i < rows.length; i++) {
    running += rows[i]!.total_cents;
    if (running / total >= 0.75) {
      const n = i + 1;
      if (n >= rows.length) return '';
      return n === 1 ? 'One carries most of it.' : `${spell(n)} carry most of it.`;
    }
  }
  return '';
}

function spell(n: number): string {
  return ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'][n] ?? String(n);
}

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}
