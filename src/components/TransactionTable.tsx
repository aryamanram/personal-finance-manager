'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TransactionRow } from './TransactionRow';
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState(initial);

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
      window.location.reload();
    },
  });

  const shownTotal = useMemo(
    () => rows.filter((r) => r.counts_as_spending).reduce((a, r) => a + r.eff_amount_cents, 0),
    [rows],
  );

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div>
      <div className="rule-b flex flex-wrap items-baseline justify-between gap-4 pb-2">
        <div className="text-xs text-paper-faint">
          <span className="figure text-paper-dim">{rows.length}</span> of{' '}
          <span className="figure text-paper-dim">{total}</span> shown ·{' '}
          spending <Figure cents={shownTotal} tone="neutral" showCents={false} />
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-paper-dim">
              <span className="figure">{selected.size}</span> selected
            </span>
            <select
              defaultValue=""
              onChange={(e) => e.target.value && bulk.mutate(e.target.value)}
              className="rounded-sm border border-ink-500 bg-ink-800 px-2 py-1 text-xs"
            >
              <option value="">Set category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.group_name} · {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSelected(new Set())}
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

      <table className="w-full table-fixed">
        <thead>
          <tr className="rule-b">
            <th className="w-8" />
            <th className="eyebrow w-24 py-2 text-left">Date</th>
            <th className="eyebrow py-2 text-left">Description</th>
            <th className="eyebrow w-56 py-2 text-left">Category</th>
            <th className="eyebrow w-28 py-2 text-left">Type</th>
            <th className="eyebrow w-32 py-2 pr-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((txn) => (
            <TransactionRow
              key={txn.id}
              txn={txn}
              categories={categories}
              selected={selected.has(txn.id)}
              onSelect={toggle}
              onPatch={(id, p) => patch.mutate({ id, patch: p })}
              pending={patch.isPending && patch.variables?.id === txn.id}
            />
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="py-12 text-center text-sm text-paper-faint">
          No transactions match these filters.
        </p>
      )}
    </div>
  );
}
