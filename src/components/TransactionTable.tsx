'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TransactionRow } from './TransactionRow';
import { CategoryPalette } from './CategoryPalette';
import { Figure } from './Figure';
import type { VTransaction, CategoryWithGroup, Account } from '@/lib/types';

/**
 * The register. Edits are optimistic and reconciled against the row the server
 * returns from v_transactions, so eff_* values never drift between client and
 * database (DESIGN.md §7).
 */
export function TransactionTable({
  initial,
  categories,
  accounts,
  total,
}: {
  initial: VTransaction[];
  categories: CategoryWithGroup[];
  accounts: Account[];
  total: number;
}) {
  const qc = useQueryClient();
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
  useEffect(() => { setRows(initial); }, [initial]);
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
  // so two rows twelve months apart can never look adjacent.
  const viewYear = useMemo(() => {
    const first = initial[0]?.eff_posted_date;
    return first ? Number(first.slice(0, 4)) : new Date().getFullYear();
  }, [initial]);

  const shownTotal = useMemo(
    () => rows.filter((r) => r.counts_as_spending).reduce((a, r) => a + r.eff_amount_cents, 0),
    [rows],
  );

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
    <div>
      <div className="rule-b flex flex-wrap items-baseline justify-between gap-4 pb-2">
        {/* The header already carries the total, so repeating "n of N" here
            said the same number twice on one screen. What this line adds is
            the money — and the fact that the view is truncated, which only
            matters when it actually is. */}
        <div className="text-xs text-paper-faint">
          Spending <Figure cents={shownTotal} tone="neutral" showCents={false} />
          {rows.length < total && (
            <>
              {' · showing the latest '}
              <span className="figure text-paper-dim">{rows.length}</span>
              {' of '}
              <span className="figure text-paper-dim">{total}</span>
            </>
          )}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-paper-dim">
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
                className="rounded-sm border border-ink-500 px-2 py-1 text-paper transition-colors hover:border-paper-faint"
              >
                Set category <span aria-hidden>▾</span>
              </button>
              {bulkOpen && (
                <div className="absolute right-0 top-full z-40 mt-1">
                  <CategoryPalette
                    categories={categories}
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
              className="text-paper-faint transition-colors hover:text-paper"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {patch.isError && (
        <p className="mt-2 text-xs text-out">{(patch.error as Error).message}</p>
      )}

      {/* Six fixed-width columns together need more than a phone's width.
          Scrolling the table inside its own container keeps the columns
          aligned and the page free of a horizontal scrollbar, rather than
          collapsing a ledger into cards where figures stop lining up. */}
      <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[680px] table-fixed">
        <thead>
          <tr className="rule-b">
            <th className="w-8 pl-1">
              <input
                type="checkbox"
                checked={allShown}
                ref={(el) => {
                  // Partial selection reads as neither on nor off.
                  if (el) el.indeterminate = someShown && !allShown;
                }}
                onChange={(e) => toggleAll(e.target.checked)}
                aria-label="Select every transaction shown"
                className="accent-edited"
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
              viewYear={viewYear}
              selected={selected.has(txn.id)}
              onSelect={toggle}
              onPatch={(id, p) => patch.mutate({ id, patch: p })}
              pending={patch.isPending && patch.variables?.id === txn.id}
            />
          ))}
        </tbody>
      </table>
      </div>

      {rows.length === 0 && (
        <p className="py-12 text-center text-sm text-paper-faint">
          No transactions match these filters.
        </p>
      )}
    </div>
  );
}
