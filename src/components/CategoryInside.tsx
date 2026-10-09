'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FlowChart } from './FlowChart';
import { useNarrow } from '@/lib/use-narrow';
import { Figure } from './Figure';
import { Segmented } from './FlowView';
import { categoryGraph, type CategoryFlowModel, type InsideOption } from '@/lib/flow';
import { registerHref } from '@/lib/register-link';
import { formatShare } from '@/lib/share';
import { formatCents } from '@/money';

const groupColor = (slot: number | null) => (slot ? `var(--color-group-${slot})` : 'var(--color-chart-strong)');
const optionColor = (o: InsideOption) => o.color ?? groupColor(o.slot);

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
  // Five columns do not fit a phone: there the table comes first, and the
  // chart is a tap away, scrolling sideways.
  const narrow = useNarrow();
  const [chosen, setView] = useState<'chart' | 'table' | null>(null);
  const view = chosen ?? (narrow ? 'table' : 'chart');
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
    <section id="inside" aria-labelledby="inside-heading" className="card scroll-mt-20">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-5">
        <div className="min-w-0">
          <h2 id="inside-heading" className="eyebrow">Inside a category</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
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
          </div>
        </div>
        {detail && (
          <Segmented
            value={view}
            onChange={setView}
            options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]}
            label={`Show ${detail.name} as`}
          />
        )}
      </div>

      {detail && (
        <p className="mt-3 px-6 text-xs text-ink-faint">
          <Figure cents={detail.cents} tone="neutral" className="figure-display font-semibold text-ink" />
          {' · '}
          <span className="figure-display">{detail.txnCount}</span> {detail.txnCount === 1 ? 'transaction' : 'transactions'}
          {detail.creditCents > 0 && (
            <>{' · '}<Figure cents={detail.creditCents} tone="neutral" /> came back</>
          )}
          {' · '}
          <Link href={all!} className="text-ink-dim underline decoration-rule-strong underline-offset-4 hover:text-ink">
            open in the register
          </Link>
        </p>
      )}

      <div className="mt-5 px-6 pb-6">
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

// ---------------------------------------------------------------------------
// The picker: a tree of groups, categories and subcategories
// ---------------------------------------------------------------------------

/** One visible line of the picker. */
type Row =
  | { kind: 'group'; key: string; name: string; slot: number | null; cents: number; open: boolean }
  | { kind: 'option'; key: string; option: InsideOption; depth: 0 | 1; parentKey: string; folds: boolean; open: boolean };

/** What the owner folded, kept between visits: a convenience, never data. */
const STORE = 'ledger.inside-picker.v1';
function remembered(): { groups: string[]; parents: string[] } {
  try {
    const raw = window.localStorage.getItem(STORE);
    const v = raw ? JSON.parse(raw) : null;
    if (v && Array.isArray(v.groups) && Array.isArray(v.parents)) return v;
  } catch { /* private window, blocked storage: start fresh */ }
  return { groups: [], parents: [] };
}
function remember(groups: Set<string>, parents: Set<string>) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify({ groups: [...groups], parents: [...parents] }));
  } catch { /* the fold still works for this visit */ }
}

/**
 * Chooses the category to look inside: every category and subcategory that
 * spent this period, under its group, with its colour and amount.
 *
 * A tree, so a long taxonomy stays short: a group folds away, and a category
 * with subcategories folds them. Groups start open and parents start folded —
 * except the one holding the current choice. Typing searches everything,
 * folded or not. Arrows move, → opens, ← folds (or steps out to the parent),
 * Enter chooses.
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
  /** Groups folded away. */
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  /** Parents unfolded to show their subcategories. */
  const [openParents, setOpenParents] = useState<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // What was folded last time, read after mount so the server render matches.
  useEffect(() => {
    const r = remembered();
    setClosedGroups(new Set(r.groups));
    setOpenParents(new Set(r.parents));
  }, []);

  const save = (groups: Set<string>, parents: Set<string>) => {
    setClosedGroups(groups);
    setOpenParents(parents);
    remember(groups, parents);
  };

  const rows = useMemo((): Row[] => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    const groups = new Map<string, InsideOption[]>();
    for (const o of options) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);

    for (const [group, items] of groups) {
      const tops = items.filter((o) => !o.parentId);
      const kids = (id: string) => items.filter((o) => o.parentId === id);
      const matches = (o: InsideOption) => !q || o.name.toLowerCase().includes(q) || group.toLowerCase().includes(q);
      // A search shows every match, with its parent for context.
      const shownTops = q ? tops.filter((t) => matches(t) || kids(t.id).some(matches)) : tops;
      if (shownTops.length === 0) continue;
      const groupOpen = q !== '' || !closedGroups.has(group);
      out.push({
        kind: 'group', key: `g:${group}`, name: group, slot: items[0].slot,
        cents: tops.reduce((a, t) => a + t.cents, 0), open: groupOpen,
      });
      if (!groupOpen) continue;
      for (const t of shownTops) {
        const children = q ? kids(t.id).filter(matches) : kids(t.id);
        const folds = kids(t.id).length > 0;
        const parentOpen = q !== '' || openParents.has(t.id) || current?.parentId === t.id;
        out.push({ kind: 'option', key: t.id, option: t, depth: 0, parentKey: `g:${group}`, folds, open: folds && parentOpen });
        if (folds && parentOpen) {
          for (const c of children) {
            out.push({ kind: 'option', key: c.id, option: c, depth: 1, parentKey: t.id, folds: false, open: false });
          }
        }
      }
    }
    return out;
  }, [options, query, closedGroups, openParents, current?.parentId]);

  // On opening, the cursor starts on the current choice; afterwards it is
  // the owner's to move.
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    if (!open) return;
    const at = rows.findIndex((r) => r.kind === 'option' && r.option.id === current?.id);
    setCursor(at >= 0 ? at : 0);
    setOpened((n) => n + 1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCursor((c) => Math.min(c, Math.max(0, rows.length - 1))); }, [rows.length]);
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, opened]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (o: InsideOption) => {
    setOpen(false);
    setQuery('');
    onPick(o.id);
  };

  const toggleGroup = (name: string) => {
    const next = new Set(closedGroups);
    if (next.has(name)) next.delete(name); else next.add(name);
    save(next, openParents);
  };
  const toggleParent = (id: string, to?: boolean) => {
    const next = new Set(openParents);
    const now = to ?? !next.has(id);
    if (now) next.add(id); else next.delete(id);
    save(closedGroups, next);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const row = rows[cursor];
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!row) return;
      if (row.kind === 'group') toggleGroup(row.name);
      else choose(row.option);
    } else if (query === '' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      if (!row) return;
      e.preventDefault();
      const opening = e.key === 'ArrowRight';
      if (row.kind === 'group') {
        if (row.open !== opening) toggleGroup(row.name);
      } else if (row.folds && row.open !== opening) {
        toggleParent(row.option.id, opening);
      } else if (!opening) {
        // Already folded, or a leaf: step out to whatever holds it.
        const up = rows.findIndex((r) => r.key === row.parentKey);
        if (up >= 0) setCursor(up);
      }
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="tree"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-lg border border-rule bg-card px-3 py-2 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:border-rule-strong"
      >
        {current && <span aria-hidden className="swatch h-2.5 w-2.5" style={{ background: optionColor(current) }} />}
        <span className="font-semibold text-ink">{current ? current.name : 'Choose a category'}</span>
        {current?.parentName && <span className="text-xs text-ink-faint">in {current.parentName}</span>}
        <ChevronDown aria-hidden size={14} className="text-ink-faint" />
        <span className="sr-only">Choose another category</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[340px] overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_16px_40px_-12px_rgb(0_0_0/0.3)]">
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onKey}
            placeholder="Find a category"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={rows[cursor] ? `${listId}-${rows[cursor].key}` : undefined}
            aria-label="Find a category"
            className="w-full border-b border-rule bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-ink-faint"
          />
          <div id={listId} ref={listRef} role="tree" aria-label="Categories" className="max-h-[360px] overflow-y-auto p-1.5">
            {rows.map((r, i) => {
              const id = `${listId}-${r.key}`;
              const at = i === cursor;
              if (r.kind === 'group') {
                return (
                  <div
                    key={r.key}
                    id={id}
                    role="treeitem"
                    aria-level={1}
                    aria-expanded={r.open}
                    aria-selected={false}
                    data-cursor={at}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => toggleGroup(r.name)}
                    className={clsx(
                      'mt-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 first:mt-0',
                      at && 'bg-well',
                    )}
                  >
                    {r.open
                      ? <ChevronDown aria-hidden size={14} className="shrink-0 text-ink-faint" />
                      : <ChevronRight aria-hidden size={14} className="shrink-0 text-ink-faint" />}
                    <span aria-hidden className="swatch" style={{ background: groupColor(r.slot) }} />
                    <span className="eyebrow !text-ink-dim">{r.name}</span>
                    <span className="figure-display ml-auto text-xs text-ink-faint">{formatCents(r.cents)}</span>
                  </div>
                );
              }
              const o = r.option;
              const chosen = o.id === current?.id;
              return (
                <div
                  key={r.key}
                  id={id}
                  role="treeitem"
                  aria-level={r.depth + 2}
                  aria-expanded={r.folds ? r.open : undefined}
                  aria-selected={chosen}
                  data-cursor={at}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(o)}
                  className={clsx(
                    'flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 text-sm',
                    r.depth === 0 ? 'pl-2' : 'pl-[2.6rem]',
                    at ? 'bg-well text-ink' : 'text-ink-dim',
                  )}
                >
                  {r.depth === 0 && (
                    r.folds ? (
                      <span
                        role="presentation"
                        title={r.open ? `Fold ${o.name}` : `Unfold ${o.name}`}
                        onClick={(e) => { e.stopPropagation(); toggleParent(o.id); }}
                        className="-m-1 rounded p-1 text-ink-faint hover:bg-rule hover:text-ink"
                      >
                        {r.open ? <ChevronDown aria-hidden size={14} /> : <ChevronRight aria-hidden size={14} />}
                      </span>
                    ) : <span aria-hidden className="inline-block w-[14px]" />
                  )}
                  <span aria-hidden className="swatch" style={{ background: optionColor(o) }} />
                  <span className={clsx('truncate', chosen && 'font-semibold text-ink')}>{o.name}</span>
                  <span className="figure-display ml-auto shrink-0 text-xs text-ink-faint">{formatCents(o.cents)}</span>
                </div>
              );
            })}
            {rows.length === 0 && <p className="px-3 py-3 text-xs text-ink-faint">No category matches.</p>}
          </div>
          <div className="border-t border-rule px-3.5 py-2 text-[11px] text-ink-faint">
            ↑↓ move · → unfold · ← fold · ⏎ choose · esc close
          </div>
        </div>
      )}
    </div>
  );
}

/** The category's own Flow as rows, each opening exactly its transactions. */
function InsideTable({ detail, period }: { detail: CategoryFlowModel; period: { from: string; to: string } }) {
  const of = (c: number) => (detail.cents > 0 ? formatShare(c / detail.cents) : '');
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
                <span className="flex items-center gap-2">
                  <span aria-hidden className="swatch" style={{ background: l.color ?? groupColor(detail.slot) }} />
                  <Link href={registerHref({ categoryId: l.id, ...period })} className="underline-offset-4 hover:underline">
                    {l.name}
                  </Link>
                </span>
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
