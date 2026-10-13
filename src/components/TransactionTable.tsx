'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TransactionRow } from './TransactionRow';
import { CategoryPalette } from './CategoryPalette';
import type { VTransaction, CategoryWithGroup, Account } from '@/lib/types';
import type { TransactionFilters } from '@/lib/queries';
import { REGISTER_BATCH } from '@/lib/register-filters';

/**
 * The register. Edits are optimistic and reconciled against the row the server
 * returns from v_transactions, so eff_* values never drift between client and
 * database (DESIGN.md §7).
 *
 * It opens on the newest REGISTER_BATCH rows and loads the next batch as it is
 * scrolled near its end, by the last row shown rather than a count, so rows
 * voided or synced meanwhile never shift what comes next. No totals: the
 * register is for finding and filing rows, not for reading sums — the Flow
 * is where the numbers are.
 */
export function TransactionTable({
  initial,
  categories,
  accounts,
  total,
  filters,
  allCategoriesHidden = false,
  groupSlots = {},
  colors = {},
}: {
  initial: VTransaction[];
  /** Each group's palette slot, so a category wears its colour (V10). */
  groupSlots?: Record<string, number>;
  /** Each category's own shade of its group's colour, by id (lib/palette.ts). */
  colors?: Record<string, string>;
  categories: CategoryWithGroup[];
  accounts: Account[];
  total: number;
  /**
   * The filters `initial` was read with, sent back for each further batch so
   * every batch is the same view. Without them the table shows `initial` only.
   */
  filters?: TransactionFilters;
  /** Every category is filtered out — an empty table the user asked for. */
  allCategoriesHidden?: boolean;
}) {
  const qc = useQueryClient();
  const colorOf = useMemo(() => {
    const group = new Map(categories.map((c) => [c.id, c.group_name]));
    return (id: string | null): string => {
      if (id && colors[id]) return colors[id];
      const slot = id ? groupSlots[group.get(id) ?? ''] : undefined;
      return slot ? `var(--color-group-${slot})` : 'var(--color-chart-strong)';
    };
  }, [categories, groupSlots, colors]);
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState(initial);

  /**
   * Follow the server's rows when they change.
   *
   * useState(initial) reads the prop once, so without this the table keeps
   * showing its first render forever: changing the period, or refreshing after
   * a bulk edit, would fetch new rows that never appeared. Optimistic edits
   * still apply locally on top of whatever the server last sent.
   */
  const view = JSON.stringify(filters ?? null);
  const last = useRef({ view, head: initial.length });
  const [end, setEnd] = useState(initial.length >= total);
  useEffect(() => {
    const before = last.current;
    last.current = { view, head: initial.length };
    if (before.view !== view) {
      // A different view — another period, filter or search: start over.
      setRows(initial);
      setEnd(initial.length >= total);
      return;
    }
    // The same view refreshed after an edit: the server's first batch, and
    // everything already scrolled into beyond it, so an edit far down the
    // register does not throw away the rows above the one just changed.
    setRows((prev) => {
      const head = new Set(initial.map((r) => r.id));
      return [...initial, ...prev.slice(before.head).filter((r) => !head.has(r.id))];
    });
  }, [initial, view, total]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadEarlier = useCallback(async () => {
    if (!filters || loading || end || rows.length === 0) return;
    const asked = view;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch('/api/transactions/earlier', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filters, after: rows[rows.length - 1].id, limit: REGISTER_BATCH }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const { rows: more } = (await res.json()) as { rows: VTransaction[] };
      // The view changed while this was in flight: these rows are not its.
      if (last.current.view !== asked) return;
      setRows((prev) => {
        const have = new Set(prev.map((r) => r.id));
        return [...prev, ...more.filter((r) => !have.has(r.id))];
      });
      if (more.length < REGISTER_BATCH) setEnd(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [filters, loading, end, rows, view]);

  // Load the next batch while the end of the table is still a screen away,
  // so scrolling rarely meets it. The button under the table does the same
  // for a keyboard, and when the observer has nothing to observe.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadRef = useRef(loadEarlier);
  useEffect(() => { loadRef.current = loadEarlier; }, [loadEarlier]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || end || !filters) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) void loadRef.current(); },
      { rootMargin: '0px 0px 900px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [end, filters, rows.length]);
  const [bulkOpen, setBulkOpen] = useState(false);
  /** The last row clicked, for shift-click range selection. */
  const anchorRef = useRef<string | null>(null);
  const bulkRef = useRef<HTMLDivElement>(null);

  // Click-outside and Escape close the bulk palette. Without this it stays
  // open behind the next click, over the rows you are trying to read.
  useEffect(() => {
    if (!bulkOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!bulkRef.current?.contains(e.target as Node)) setBulkOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [bulkOpen]);

  const patch = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Update failed');
      }
      return (await res.json()).transaction as VTransaction;
    },
    // Optimistic: apply locally, keep the old row to roll back to.
    onMutate: ({ id, patch: p }) => {
      const previous = rows.find((r) => r.id === id);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } as VTransaction : r)));
      return { previous };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.previous) setRows((rs) => rs.map((r) => (r.id === id ? ctx.previous! : r)));
    },
    // Reconcile against the server's resolved row, then refresh the charts —
    // a stale chart after an edit is the failure mode to avoid.
    onSuccess: (fresh) => {
      setRows((rs) => rs.map((r) => (r.id === fresh.id ? fresh : r)));
      qc.invalidateQueries({ queryKey: ['cashflow'] });
      // The spending total is the server's, over every matching row; an
      // amount, a void or a recategorisation can move it.
      router.refresh();
    },
  });

  /**
   * Confirming a guess: same category, now a human decision.
   *
   * It cannot go through `patch` — PATCHing category_id to the value the row
   * already holds is a no-op that never sets the lock, which is the entire
   * point. This route confirms instead, writing category_source='manual' and
   * tripping the lock trigger (I4).
   */
  const confirm = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transactions/${id}/merchant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category_id: rows.find((r) => r.id === id)!.category_id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Confirm failed');
      }
      return (await res.json()).transaction as VTransaction;
    },
    onSuccess: (fresh) => {
      setRows((rs) => rs.map((r) => (r.id === fresh.id ? fresh : r)));
      qc.invalidateQueries({ queryKey: ['cashflow'] });
    },
  });

  const bulk = useMutation({
    mutationFn: async (categoryId: string) => {
      const res = await fetch('/api/transactions/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), category_id: categoryId }),
      });
      if (!res.ok) throw new Error('Bulk update failed');
      return (await res.json()).updated as number;
    },
    onSuccess: () => {
      setSelected(new Set());
      anchorRef.current = null;
      // router.refresh() rather than a full reload: re-running the server
      // component brings back the updated rows without throwing away scroll
      // position, which a full reload did — in the middle of working down a
      // backlog, that meant finding your place again after every bulk edit.
      router.refresh();
      qc.invalidateQueries({ queryKey: ['cashflow'] });
    },
  });

  // The year most of the register is in — dates outside it carry a short year

  /**
   * Toggles one row, or — with shift held — every row between the last one
   * clicked and this one.
   *
   * Categorising a statement means picking up runs of adjacent rows: a week of
   * one merchant, a block of transfers. Without a range gesture that is one
   * click per row, which is what made bulk selection not worth using.
   */
  const toggle = (id: string, on: boolean, extend = false) => {
    const anchor = anchorRef.current;
    anchorRef.current = id;

    setSelected((s) => {
      const next = new Set(s);
      if (extend && anchor && anchor !== id) {
        const a = rows.findIndex((r) => r.id === anchor);
        const b = rows.findIndex((r) => r.id === id);
        if (a >= 0 && b >= 0) {
          // The whole span takes the state of the row that was clicked, so a
          // shift-click can clear a run as well as select one.
          for (const r of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (on) next.add(r.id);
            else next.delete(r.id);
          }
          return next;
        }
      }
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someShown = rows.some((r) => selected.has(r.id));

  const toggleAll = (on: boolean) => {
    anchorRef.current = null;
    setSelected(on ? new Set(rows.map((r) => r.id)) : new Set());
  };

  return (
    <div className={selected.size > 0 ? 'pb-20' : undefined}>
      <div className="card overflow-hidden">
      {patch.isError && (
        <p className="px-5 pt-3 text-xs text-alert sm:px-6">{(patch.error as Error).message}</p>
      )}

      {/* Six fixed-width columns together need more than a phone's width.
          Scrolling the table inside its own container keeps the columns
          aligned and the page free of a horizontal scrollbar, rather than
          collapsing a ledger into cards where figures stop lining up. */}
      <div className="overflow-x-auto px-3 pb-2 pt-1 sm:px-4">
      <table className="w-full min-w-[680px] table-fixed">
        <thead>
          <tr className="rule-b">
            <th className="w-8 pl-1 text-left">
              <input
                type="checkbox"
                checked={allShown}
                ref={(el) => {
                  // Partial selection reads as neither on nor off.
                  if (el) el.indeterminate = someShown && !allShown;
                }}
                onChange={(e) => toggleAll(e.target.checked)}
                aria-label="Select every transaction shown"
                className="accent-ink"
              />
            </th>
            <th className="eyebrow w-24 py-2 text-left">Date</th>
            <th className="eyebrow py-2 text-left">Description</th>
            <th className="eyebrow w-56 py-2 text-left">Category</th>
            <th className="eyebrow w-32 py-2 pr-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((txn, i) => (
            <TransactionRow
              key={txn.id}
              txn={txn}
              categories={categories}
              // Rows are sorted by date descending, so a repeat is always the
              // row immediately above.
              repeatsDate={i > 0 && rows[i - 1]!.eff_posted_date === txn.eff_posted_date}
              swatch={colorOf(txn.category_id)}
              groupSlots={groupSlots}
              colors={colors}
              selected={selected.has(txn.id)}
              onSelect={toggle}
              onPatch={(id, p) => patch.mutate({ id, patch: p })}
              onConfirm={(id) => confirm.mutate(id)}
              pending={
                (patch.isPending && patch.variables?.id === txn.id)
                || (confirm.isPending && confirm.variables === txn.id)
              }
            />
          ))}
        </tbody>
      </table>
      </div>

      {rows.length === 0 && (
        <p className="py-12 text-center text-sm text-ink-faint">
          {/* "Hide all" is the first half of picking a few categories, so
              this state is reached ON PURPOSE. Saying nothing matched would
              blame the data for a choice the user just made. */}
          {allCategoriesHidden
            ? 'Every category is hidden. Tick the ones you want to see.'
            : 'No transactions match these filters.'}
        </p>
      )}

      {/* The end of what is loaded. Watched, so the next batch arrives
          before scrolling reaches it; a button, so a keyboard can ask. */}
      {/* Only when there is more to load, or more was loaded: a view that
          fits in one batch ends with its last row. */}
      {rows.length > 0 && filters && (!end || rows.length > REGISTER_BATCH) && (
        <div ref={sentinel} className="rule-t flex items-center justify-center px-5 py-4 text-xs text-ink-faint">
          <span aria-live="polite">
            {end ? (
              'That’s every transaction in this view.'
            ) : loadError ? (
              <>
                Couldn’t load earlier transactions.{' '}
                <button type="button" onClick={() => void loadEarlier()}
                  className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                  Try again
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void loadEarlier()} disabled={loading}
                className="rounded-lg px-3 py-1.5 transition-colors hover:bg-well/60 hover:text-ink disabled:hover:bg-transparent">
                {loading ? 'Loading earlier transactions…' : 'Load earlier transactions'}
              </button>
            )}
          </span>
        </div>
      )}
      </div>

      {/* Fixed to the VIEWPORT, not the top of the table. Selecting rows at
          the bottom of a 300-row register used to mean scrolling back up to
          reach "Set category" — the controls were pinned above the table, so
          the further you worked down the backlog the further away they got.
          A bar that follows the viewport is in reach from any scroll
          position, and it only exists while something is selected. */}
      {selected.size > 0 && (
        // Right of the sidebar (w-20, lg:w-56), lined up with the page's own column.
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-rule-strong bg-raised/95 backdrop-blur md:left-20 lg:left-56">
          <div className="mx-auto flex max-w-[1760px] flex-wrap items-center justify-end gap-3 px-4 py-3 text-xs sm:px-6 md:px-8">
            <span className="mr-auto text-ink-dim">
              <span className="figure">{selected.size}</span> selected
            </span>

            {/* The same palette a single row opens. This was a flat <select>
                of all 35 categories, so the one place you pick a category for
                twelve rows at once was the one place with no grouping and no
                search — the hardest pick got the worst control. */}
            <div ref={bulkRef} className="relative">
              <button
                onClick={() => setBulkOpen((o) => !o)}
                aria-expanded={bulkOpen}
                className="rounded-sm border border-ink-faint px-3 py-1.5 text-ink transition-colors hover:border-ink-faint"
              >
                Set category <span aria-hidden>▾</span>
              </button>
              {bulkOpen && (
                /* Opens UPWARD: the bar is at the bottom of the screen, so a
                   panel below it would be off-screen. */
                <div className="absolute bottom-full right-0 z-50 mb-1">
                  <CategoryPalette
                    categories={categories}
                    groupSlots={groupSlots}
                    colors={colors}
                    onPick={(id) => {
                      // Bulk-clearing to Uncategorized is not offered: the
                      // palette's clear row only appears for a single row's
                      // current category, and undoing it across a selection
                      // has no single previous state to return to.
                      if (id) bulk.mutate(id);
                      setBulkOpen(false);
                    }}
                    onClose={() => setBulkOpen(false)}
                  />
                </div>
              )}
            </div>

            <button
              onClick={() => { setSelected(new Set()); anchorRef.current = null; }}
              className="px-2 text-ink-faint transition-colors hover:text-ink"
            >
              Clear
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
