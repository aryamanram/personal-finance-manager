'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { FlowChart } from './FlowChart';
import { useNarrow } from '@/lib/use-narrow';
import { Figure } from './Figure';
import { flowGraph, type FlowModel, type FlowCategory, type BucketKey } from '@/lib/flow';
import { registerHref } from '@/lib/register-link';

/**
 * Each gap holds the labels of the column to its right (or, for the first,
 * the sources'); the categories' gap is widest, since that is where the
 * colour fans out.
 */
const MAIN_GAPS = [1, 0.85, 1.25, 1.1];

const NECESSITY: Record<BucketKey, string | undefined> = {
  required: 'required', discretionary: 'discretionary', invested: 'investment', leftover: undefined,
};

/**
 * The main Flow: where the period's money came from and where it went, as a
 * chart or as a table of the same numbers.
 *
 * Clicking a category looks inside it — the category's own Flow, further down
 * the page — by putting it in the URL, so the back button undoes it. Its rows
 * are one more click away, from there or from the table.
 */
export function FlowView({
  model,
  period,
  label,
  range,
}: {
  model: FlowModel | null;
  period: { from: string; to: string };
  /** "September 2026": what the chart is of, for its accessible name. */
  label: string;
  /** "Sep 1 – 27, 2026": the dates the card's heading names. */
  range?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Five columns do not fit a phone: there the table comes first, and the
  // chart is a tap away, scrolling sideways.
  const narrow = useNarrow();
  const [chosen, setView] = useState<'chart' | 'table' | null>(null);
  const view = chosen ?? (narrow ? 'table' : 'chart');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const graph = useMemo(
    () => (model ? flowGraph(model, period, expanded) : { nodes: [], links: [] }),
    [model, period, expanded],
  );

  const everyKey = useMemo(() => {
    const keys = new Set<string>();
    for (const b of model?.buckets ?? []) {
      keys.add(`bucket:${b.key}`);
      for (const c of b.categories) keys.add(`cat:${b.key}:${c.id ?? 'none'}`);
    }
    return keys;
  }, [model]);
  const foldable = graph.nodes.some((n) => n.kind === 'more');
  const allOpen = expanded.size > 0 && !foldable;

  const legend = useMemo(() => groupsIn(model), [model]);

  const focus = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('focus', id);
    // The hash scrolls to the category's own Flow once it has rendered.
    router.push(`${pathname}?${next.toString()}#inside`);
  };

  return (
    <section aria-labelledby="flow-heading" className="card">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-5">
        <div>
          <h2 id="flow-heading" className="eyebrow">Where it went</h2>
          {range && <p className="mt-1 text-lg font-semibold tracking-tight text-ink">{range}</p>}
        </div>
        <div className="flex items-center gap-2">
          {view === 'chart' && (foldable || allOpen) && (
            <button
              type="button"
              onClick={() => setExpanded(allOpen ? new Set() : everyKey)}
              className="rounded-lg border border-rule bg-card px-3 py-1.5 text-xs font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:border-rule-strong"
            >
              {allOpen ? 'Show the largest' : 'Show every category'}
            </button>
          )}
          <Segmented
            value={view}
            onChange={setView}
            options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]}
            label="Show the Flow as"
          />
        </div>
      </div>

      {legend.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 px-6 text-xs text-ink-dim" aria-label="Category groups">
          {legend.map((g) => (
            <li key={g.name} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="swatch"
                style={{ background: g.slot ? `var(--color-group-${g.slot})` : 'var(--color-chart-strong)' }}
              />
              {g.name}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 px-6 pb-6">
        {view === 'chart' ? (
          <FlowChart
            graph={graph}
            label={`Where ${label}'s money went`}
            gaps={MAIN_GAPS}
            onFocusCategory={focus}
            onExpand={(key) => setExpanded((e) => new Set([...e, key]))}
          />
        ) : (
          <FlowTable model={model} period={period} onFocus={focus} />
        )}
      </div>
    </section>
  );
}

/** The groups this period spent in, in palette order. */
function groupsIn(model: FlowModel | null): { name: string; slot: number | null }[] {
  const seen = new Map<string, number | null>();
  for (const b of model?.buckets ?? []) for (const c of b.categories) seen.set(c.group, c.slot);
  return [...seen.entries()]
    .map(([name, slot]) => ({ name, slot }))
    .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.name.localeCompare(b.name));
}

export function Segmented<T extends string>({
  value, onChange, options, label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    // A segmented control: a sunken track with the chosen segment raised.
    <div role="group" aria-label={label} className="flex rounded-lg bg-well p-0.5 text-xs font-medium">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md px-3 py-1 transition-all',
            value === o.value
              ? 'bg-card text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.04)]'
              : 'text-ink-dim hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The Flow as rows: every source, bucket, category and subcategory, nothing
 * folded. Each name opens exactly its rows (V2); a category can also be
 * looked inside, as in the chart.
 */
export function FlowTable({
  model,
  period,
  onFocus,
}: {
  model: FlowModel | null;
  period: { from: string; to: string };
  onFocus?: (id: string) => void;
}) {
  if (!model) return <p className="py-10 text-center text-sm text-ink-faint">No money moved in this period.</p>;
  const share = (c: number) => (model.spendingCents > 0 ? `${((c / model.spendingCents) * 100).toFixed(1)}%` : '');
  const rows = (r: Omit<Parameters<typeof registerHref>[0], 'from' | 'to'>) => registerHref({ ...r, ...period });

  const sourceHref: Record<string, string | undefined> = {
    income: rows({ necessity: 'income' }),
    credits: rows({ credits: true }),
    investments: rows({ necessity: 'investment' }),
  };

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Where the money came from and went, with each category&apos;s share of spending</caption>
      <thead>
        <tr className="rule-b">
          <th scope="col" className="eyebrow py-2 text-left font-normal">Where</th>
          <th scope="col" className="eyebrow w-36 py-2 text-right font-normal">Amount</th>
          <th scope="col" className="eyebrow hidden w-28 py-2 text-right font-normal sm:table-cell">Of spending</th>
          <th scope="col" className="eyebrow hidden w-28 py-2 text-right font-normal sm:table-cell">Transactions</th>
          <th scope="col" className="w-28 py-2"><span className="sr-only">Look inside</span></th>
        </tr>
      </thead>
      <tbody>
        <tr><th colSpan={5} scope="rowgroup" className="eyebrow pt-5 pb-1 text-left font-normal">Came in</th></tr>
        {model.sources.map((s) => (
          <tr key={s.key} className="rule-b">
            <th scope="row" className="py-2 text-left font-medium">
              <RowLink href={sourceHref[s.key]}>{s.label}</RowLink>
            </th>
            <td className="py-2 text-right"><Figure cents={s.cents} tone="neutral" /></td>
            <td className="hidden sm:table-cell" /><td className="hidden sm:table-cell" /><td />
          </tr>
        ))}

        <tr><th colSpan={5} scope="rowgroup" className="eyebrow pt-6 pb-1 text-left font-normal">Went to</th></tr>
        {model.buckets.map((b) => {
          const necessity = NECESSITY[b.key];
          return [
            <tr key={b.key} className="rule-b">
              <th scope="row" className="py-2 text-left font-medium">
                <RowLink href={necessity ? rows({ necessity }) : undefined}>{b.label}</RowLink>
              </th>
              <td className="py-2 text-right"><Figure cents={b.cents} tone="neutral" className="font-medium" /></td>
              <td className="hidden py-2 text-right text-xs text-ink-faint sm:table-cell">
                {b.categories.length > 0 ? share(b.cents) : ''}
              </td>
              <td className="hidden sm:table-cell" /><td />
            </tr>,
            ...b.categories.flatMap((c) => categoryRows(c, b.key, necessity, rows, share, onFocus)),
          ];
        })}
      </tbody>
    </table>
  );
}

function categoryRows(
  c: FlowCategory,
  bucket: BucketKey,
  necessity: string | undefined,
  rows: (r: Omit<Parameters<typeof registerHref>[0], 'from' | 'to'>) => string,
  share: (c: number) => string,
  onFocus?: (id: string) => void,
) {
  const swatch = c.color ?? (c.slot ? `var(--color-group-${c.slot})` : 'var(--color-chart-strong)');
  const out = [
    <tr key={`${bucket}:${c.id}`} className="rule-b">
      <th scope="row" className="py-2 pl-4 text-left font-normal">
        <span className="flex items-center gap-2">
          <span aria-hidden className="swatch" style={{ background: swatch }} />
          <RowLink href={rows({ categoryId: c.id, withSubcategories: true, necessity })}>{c.name}</RowLink>
        </span>
      </th>
      <td className="py-2 text-right"><Figure cents={c.cents} tone="neutral" /></td>
      <td className="hidden py-2 text-right text-xs text-ink-faint sm:table-cell">{share(c.cents)}</td>
      <td className="figure hidden py-2 text-right text-xs text-ink-faint sm:table-cell">{c.txnCount}</td>
      <td className="py-2 text-right">
        {c.id && onFocus && (
          <button
            type="button"
            onClick={() => onFocus(c.id!)}
            className="text-xs text-ink-faint underline decoration-rule-strong underline-offset-4 transition-colors hover:text-ink"
            aria-label={`Look inside ${c.name}`}
          >
            Look inside
          </button>
        )}
      </td>
    </tr>,
  ];
  for (const k of c.children) {
    out.push(
      <tr key={`${bucket}:${c.id}:${k.general ? 'general' : k.id}`} className="rule-b">
        <th scope="row" className="py-1.5 pl-10 text-left text-ink-dim font-normal">
          <span className="flex items-center gap-2">
          <span aria-hidden className="swatch" style={{ background: k.color ?? swatch }} />
          <RowLink href={rows({ categoryId: k.id, necessity })}>
            {k.name}
            {k.general && <span className="sr-only"> (in {c.name}, not in a subcategory)</span>}
          </RowLink>
          </span>
        </th>
        <td className="py-1.5 text-right"><Figure cents={k.cents} tone="neutral" /></td>
        <td className="hidden py-1.5 text-right text-xs text-ink-faint sm:table-cell">{share(k.cents)}</td>
        <td className="figure hidden py-1.5 text-right text-xs text-ink-faint sm:table-cell">{k.txnCount}</td>
        <td />
      </tr>,
    );
  }
  return out;
}

function RowLink({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <span>{children}</span>;
  return (
    <Link href={href} className="decoration-rule-strong underline-offset-4 transition-colors hover:underline">
      {children}
    </Link>
  );
}
