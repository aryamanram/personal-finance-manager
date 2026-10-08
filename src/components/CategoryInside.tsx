'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { FlowChart } from './FlowChart';
import { Figure } from './Figure';
import { Segmented } from './FlowView';
import { categoryGraph, type CategoryFlowModel, type InsideOption } from '@/lib/flow';
import { registerHref } from '@/lib/register-link';
import { formatCents } from '@/money';

const swatch = (slot: number | null) => (slot ? `var(--color-group-${slot})` : 'var(--color-chart-strong)');

/**
 * The second level of Flow: one category, from the buckets that paid for it,
 * through its subcategories, to the merchants.
 *
 * Which category is in the URL (?focus=), so a reload keeps it and the back
 * button undoes it. Clicking a subcategory here looks inside that in turn.
 */
export function CategoryInside({
  detail,
  options,
  period,
}: {
  detail: CategoryFlowModel | null;
  options: InsideOption[];
  period: { from: string; to: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // A new category starts folded again.
  useEffect(() => { setExpanded(new Set()); }, [detail?.id]);

  const graph = useMemo(
    () => (detail ? categoryGraph(detail, period, expanded) : { nodes: [], links: [] }),
    [detail, period, expanded],
  );

  const pick = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('focus', id);
    router.push(`${pathname}?${next.toString()}#inside`, { scroll: false });
  };

  if (options.length === 0) return null;
  const current = options.find((o) => o.id === detail?.id);
  const all = detail ? registerHref({ categoryId: detail.id, withSubcategories: true, ...period }) : undefined;

  return (
    <section id="inside" aria-labelledby="inside-heading" className="scroll-mt-20">
      <div className="rule-b flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-2">
        <h2 id="inside-heading" className="eyebrow">Inside a category</h2>
        {detail && (
          <Segmented
            value={view}
            onChange={setView}
            options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]}
            label={`Show ${detail.name} as`}
          />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Picker options={options} current={current} onPick={pick} />
        {current?.parentId && (
          <button
            type="button"
            onClick={() => pick(current.parentId!)}
            className="text-xs text-ink-faint transition-colors hover:text-ink"
          >
            ← all of {current.parentName}
          </button>
        )}
        {detail && (
          <p className="text-xs text-ink-faint">
            <Figure cents={detail.cents} tone="neutral" className="text-ink" />
            {' · '}
            <span className="figure">{detail.txnCount}</span> {detail.txnCount === 1 ? 'transaction' : 'transactions'}
            {detail.creditCents > 0 && (
              <>{' · '}<Figure cents={detail.creditCents} tone="neutral" /> came back</>
            )}
            {' · '}
            <Link href={all!} className="text-ink-dim underline decoration-rule-strong underline-offset-4 hover:text-ink">
              open in the register
            </Link>
          </p>
        )}
      </div>

      <div className="mt-4">
        {!detail ? (
          <p className="py-10 text-center text-sm text-ink-faint">
            Nothing was spent in this category in this period.
          </p>
        ) : view === 'chart' ? (
          <FlowChart
            graph={graph}
            label={`Inside ${detail.name}`}
            onFocusCategory={pick}
            onExpand={(key) => setExpanded((e) => new Set([...e, key]))}
          />
        ) : (
          <InsideTable detail={detail} period={period} />
        )}
      </div>
    </section>
  );
}

/**
 * Chooses the category to look inside: every category and subcategory that
 * spent this period, under its group, with its colour and amount. Type to
 * narrow; arrows and Enter to choose.
 */
function Picker({
  options,
  current,
  onPick,
}: {
  options: InsideOption[];
  current?: InsideOption;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q) || o.group.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => { setCursor(0); }, [query]);

  const choose = (o?: InsideOption) => {
    if (!o) return;
    setOpen(false);
    setQuery('');
    onPick(o.id);
  };

  const groups: [string, InsideOption[]][] = [];
  for (const o of shown) {
    const g = groups.find(([name]) => name === o.group);
    if (g) g[1].push(o);
    else groups.push([o.group, [o]]);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-sm border border-rule-strong bg-raised px-3 py-2 text-sm transition-colors hover:border-ink-faint"
      >
        {current && <span aria-hidden className="swatch" style={{ background: swatch(current.slot) }} />}
        <span className="font-medium text-ink">{current ? current.name : 'Choose a category'}</span>
        {current?.parentName && <span className="text-xs text-ink-faint">in {current.parentName}</span>}
        <span aria-hidden className="text-ink-faint">▾</span>
        <span className="sr-only">Choose another category</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[320px] overflow-hidden rounded-sm border border-rule-strong bg-raised shadow-xl shadow-black/20">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(shown.length - 1, c + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); choose(shown[cursor]); }
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Find a category"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={shown[cursor] ? `${listId}-${shown[cursor].id}` : undefined}
            aria-label="Find a category"
            className="w-full border-b border-rule bg-transparent px-3 py-2 text-sm outline-none placeholder:text-ink-faint"
          />
          <div id={listId} role="listbox" aria-label="Categories" className="max-h-[320px] overflow-y-auto py-1">
            {groups.map(([group, items]) => (
              <div key={group} role="group" aria-label={group}>
                <div className="eyebrow px-3 pt-2 pb-1">{group}</div>
                {items.map((o) => {
                  const i = shown.indexOf(o);
                  return (
                    <div
                      key={o.id}
                      id={`${listId}-${o.id}`}
                      role="option"
                      aria-selected={o.id === current?.id}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => choose(o)}
                      className={clsx(
                        'flex cursor-pointer items-center gap-2 py-1.5 pr-3 text-sm',
                        o.parentId ? 'pl-8' : 'pl-3',
                        i === cursor ? 'bg-well text-ink' : 'text-ink-dim',
                      )}
                    >
                      <span aria-hidden className="swatch" style={{ background: swatch(o.slot) }} />
                      <span className="truncate">{o.name}</span>
                      <span className="figure ml-auto shrink-0 text-xs text-ink-faint">{formatCents(o.cents)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            {shown.length === 0 && <p className="px-3 py-3 text-xs text-ink-faint">No category matches.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** The category's own Flow as rows, each opening exactly its transactions. */
function InsideTable({ detail, period }: { detail: CategoryFlowModel; period: { from: string; to: string } }) {
  const of = (c: number) => (detail.cents > 0 ? `${((c / detail.cents) * 100).toFixed(1)}%` : '');
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{detail.name}, by {detail.split ? 'subcategory and ' : ''}merchant</caption>
      <thead>
        <tr className="rule-b">
          <th scope="col" className="eyebrow py-2 text-left font-normal">{detail.split ? 'Subcategory and merchant' : 'Merchant'}</th>
          <th scope="col" className="eyebrow w-36 py-2 text-right font-normal">Amount</th>
          <th scope="col" className="eyebrow hidden w-28 py-2 text-right font-normal sm:table-cell">Of {detail.name}</th>
          <th scope="col" className="eyebrow hidden w-28 py-2 text-right font-normal sm:table-cell">Transactions</th>
        </tr>
      </thead>
      <tbody>
        {detail.leaves.flatMap((l) => [
          ...(detail.split ? [
            <tr key={`leaf:${l.id}`} className="rule-b">
              <th scope="row" className="py-2 text-left font-medium">
                <Link href={registerHref({ categoryId: l.id, ...period })} className="underline-offset-4 hover:underline">
                  {l.name}
                </Link>
              </th>
              <td className="py-2 text-right"><Figure cents={l.cents} tone="neutral" /></td>
              <td className="hidden py-2 text-right text-xs text-ink-faint sm:table-cell">{of(l.cents)}</td>
              <td className="figure hidden py-2 text-right text-xs text-ink-faint sm:table-cell">{l.txnCount}</td>
            </tr>,
          ] : []),
          ...l.merchants.map((m) => (
            <tr key={`m:${l.id}:${m.id ?? m.name}`} className="rule-b">
              <th scope="row" className={clsx('py-1.5 text-left font-normal text-ink-dim', detail.split && 'pl-6')}>
                <Link
                  href={registerHref({ categoryId: l.id, merchantId: m.id, ...period })}
                  className="underline-offset-4 hover:underline"
                >
                  {m.name}
                </Link>
              </th>
              <td className="py-1.5 text-right"><Figure cents={m.cents} tone="neutral" /></td>
              <td className="hidden py-1.5 text-right text-xs text-ink-faint sm:table-cell">{of(m.cents)}</td>
              <td className="figure hidden py-1.5 text-right text-xs text-ink-faint sm:table-cell">{m.txnCount}</td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}
