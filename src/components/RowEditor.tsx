'use client';

import { useEffect, useState } from 'react';
import { CategoryPalette } from './CategoryPalette';
import type { VTransaction, CategoryWithGroup } from '@/lib/types';
import type { MerchantContext } from '@/lib/queries';

/**
 * The expanded row (wireframe 35:2): name it, categorise it, and decide
 * whether the next one categorises itself.
 *
 * `description` has always been editable — the API and schema supported it and
 * the register simply never exposed it. The bank's string stays in
 * `raw_description` and is shown underneath, because that is what
 * reconciliation reads (I2).
 */
export function RowEditor({
  txn,
  categories,
  usage,
  onPatch,
  onClose,
}: {
  txn: VTransaction;
  categories: CategoryWithGroup[];
  usage: Record<string, number>;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(txn.eff_description ?? '');
  const [picking, setPicking] = useState(false);
  const [merchant, setMerchant] = useState<MerchantContext | null>(null);
  const [applySiblings, setApplySiblings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/transactions/${txn.id}/merchant`)
      .then((r) => r.json())
      .then((d) => { if (live) setMerchant(d.merchant ?? null); })
      .catch(() => { /* the panel works without it */ });
    return () => { live = false; };
  }, [txn.id]);

  const renamed = txn.description !== null && txn.description !== '';
  const isGuess =
    !txn.category_locked &&
    txn.category_id !== null &&
    ['rule', 'llm', 'import'].includes(txn.category_source);

  /** Commits the name, but only when it actually changed. */
  function commitName() {
    const next = name.trim();
    if (next === (txn.eff_description ?? '')) return;
    // Clearing the box restores the bank's own string rather than blanking the
    // row: description is the override, raw_description is the truth.
    onPatch(txn.id, { description: next === '' ? null : next });
  }

  async function pick(categoryId: string | null) {
    setPicking(false);
    if (categoryId === null) {
      onPatch(txn.id, { category_id: null });
      return;
    }

    // A plain pick is just a patch. Only "apply to the others" needs the
    // merchant endpoint — and it is also what CONFIRMS a guess, since patching
    // a category to the value it already has is a no-op that never locks.
    if (!merchant || !applySiblings) {
      if (categoryId === txn.category_id && isGuess) {
        await confirmOnly(categoryId);
        return;
      }
      onPatch(txn.id, { category_id: categoryId });
      return;
    }

    await post({ category_id: categoryId, apply_to_siblings: applySiblings });
  }

  /** Agreeing with the machine: same category, but now a human decision. */
  async function confirmOnly(categoryId: string) {
    await post({ category_id: categoryId, apply_to_siblings: false });
  }

  async function post(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${txn.id}/merchant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Update failed');
      // Other rows may have changed underneath the table.
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="bg-ink-850 px-4 py-4">
      <div className="max-w-3xl space-y-5">
        <div>
          <label className="eyebrow block" htmlFor={`name-${txn.id}`}>Name it</label>
          <input
            id={`name-${txn.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitName(); }
              if (e.key === 'Escape') { setName(txn.eff_description ?? ''); onClose(); }
            }}
            placeholder={txn.raw_description}
            className="mt-2 w-full rounded-sm border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-paper outline-none transition-colors focus:border-ink-500"
          />
          {/* Only once the name differs from the bank's. Before that the
              input already shows the raw description, so repeating it below
              was the same string twice — and the sentence explaining that I2
              keeps the original said the same thing under every row forever.
              "Restore the bank's name" carries that affordance instead. */}
          {renamed && (
            <p className="mt-2 text-xs text-paper-faint">
              <span className="figure">{txn.raw_description}</span>
            </p>
          )}
        </div>

        <div>
          <span className="eyebrow block">Category</span>
          {picking ? (
            <div className="mt-2">
              <CategoryPalette
                categories={categories}
                usage={usage}
                suggestedId={txn.suggested_category_id}
                unconfirmedId={isGuess ? txn.category_id : null}
                currentId={txn.category_id}
                onPick={pick}
                onClose={() => setPicking(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setPicking(true)}
              disabled={saving}
              className="mt-2 flex w-full items-center justify-between gap-3 rounded-sm border border-ink-600 bg-ink-800 px-3 py-2 text-left text-sm transition-colors hover:border-ink-500 disabled:opacity-60"
            >
              <span className={txn.category_name ? 'text-paper' : 'text-paper-faint'}>
                {txn.category_name ?? 'Uncategorized'}
              </span>
              <span className="text-xs text-paper-faint">
                {txn.eff_cost_type} · {txn.eff_necessity}
              </span>
            </button>
          )}
        </div>

        {/* A one-time action on rows that exist NOW. The standing "categorise
            every future X this way" checkbox is gone: a stored per-merchant
            default re-asserted itself on every sync and silently reverted
            later, more specific decisions — it would have undone every
            subcategory assignment. A repeat charge is handled by a rule or the
            model, both of which are visible and editable. */}
        {merchant && merchant.siblings > 0 && (
          <div className="border-l-2 border-edited/40 pl-4">
            <label className="flex items-start gap-2 text-xs text-paper-dim">
              <input
                type="checkbox"
                checked={applySiblings}
                onChange={(e) => setApplySiblings(e.target.checked)}
                className="mt-0.5 accent-edited"
              />
              <span>
                Also apply to the{' '}
                <span className="figure text-paper">{merchant.siblings}</span>{' '}
                other unreviewed {merchant.merchant_name}{' '}
                {merchant.siblings === 1 ? 'row' : 'rows'}
              </span>
            </label>
            {applySiblings && (
              <p className="mt-2 text-xs leading-relaxed text-paper-faint">
                Applied when you pick a category above. Rows you decided by
                hand are never touched.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-out">{error}</p>}

        <div className="flex items-center gap-4 text-xs">
          <button
            onClick={() => { commitName(); onClose(); }}
            className="border-b border-paper-faint pb-0.5 text-paper transition-colors hover:border-paper"
          >
            Done
          </button>
          {renamed && (
            <button
              onClick={() => {
                onPatch(txn.id, { description: null });
                setName(txn.raw_description);
              }}
              className="text-paper-faint transition-colors hover:text-paper"
            >
              Restore the bank’s name
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
