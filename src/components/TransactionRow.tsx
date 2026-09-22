'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Figure } from './Figure';
import { CategoryPalette } from './CategoryPalette';
import { RowEditor } from './RowEditor';
import { formatCents } from '@/money';
import type { VTransaction, CategoryWithGroup } from '@/lib/types';

/**
 * One line of the register. Click to edit in place.
 *
 * Voided rows are shown struck through rather than hidden (I5) — a row you
 * cannot see is a row you cannot audit.
 */
export function TransactionRow({
  txn,
  categories,
  usage,
  selected,
  onSelect,
  onPatch,
  pending,
}: {
  txn: VTransaction;
  categories: CategoryWithGroup[];
  usage: Record<string, number>;
  selected: boolean;
  onSelect: (id: string, on: boolean) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  pending?: boolean;
}) {
  const [editing, setEditing] = useState<null | 'category' | 'amount'>(null);
  const [expanded, setExpanded] = useState(false);
  const voided = txn.voided_at !== null;

  // Renamed: a display override exists, so the bank's string is worth showing.
  const renamed = txn.description !== null && txn.description !== '';
  // A machine chose it and no human has confirmed. NOT amber — amber is
  // reserved for "a human changed this" (CLAUDE.md), and this is the opposite:
  // nobody has touched it yet.
  const isGuess =
    !txn.category_locked &&
    txn.category_id !== null &&
    ['rule', 'llm', 'import'].includes(txn.category_source);

  /** Agreeing with the machine: same category, but now a human decision. */
  async function confirmGuess(id: string) {
    const res = await fetch(`/api/transactions/${id}/merchant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category_id: txn.category_id,
        set_default: false,
        apply_to_siblings: false,
      }),
    });
    // The lock and the backlog count both live server-side.
    if (res.ok) window.location.reload();
  }

  return (
    <>
    <tr
      className={clsx(
        'rule-b group transition-colors',
        voided ? 'text-paper-faint' : 'hover:bg-ink-850',
        /* Dim the row's own text, not the subtree. `opacity` on the <tr>
           composites every descendant against the page — including the
           "pending" badge, whose background and text fade together. That took
           the badge to 2.46:1, well under AA, and the badge is the one thing
           on a pending row you actually need to read. */
        pending && !voided && 'text-paper-dim',
      )}
    >
      <td className="w-8 py-2 pl-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(txn.id, e.target.checked)}
          aria-label={`Select ${txn.eff_description}`}
          className="accent-edited"
        />
      </td>

      <td className="figure w-24 py-2 text-xs text-paper-faint">
        <span
          className={clsx(txn.posted_date_override && 'edited')}
          title={
            txn.posted_date_override
              ? `Bank reported ${txn.posted_date} — corrected by hand`
              : undefined
          }
        >
          {txn.eff_posted_date}
        </span>
      </td>

      <td className="py-2 pr-3 align-top">
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="block w-full text-left"
        >
          <span className={clsx('block truncate text-sm', voided && 'line-through')}>
            {txn.eff_description}
          </span>
          {/* The bank's own string, kept visible under the rename (I2). */}
          {renamed && (
            <span className="figure mt-0.5 block truncate text-xs text-paper-faint">
              {txn.raw_description}
            </span>
          )}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-paper-faint">
          <span>{txn.account_name}</span>
          {txn.status === 'pending' && <Badge tone="neutral">pending</Badge>}
          {txn.transfer_id && <Badge tone="neutral">transfer</Badge>}
          {voided && <Badge tone="out">{txn.void_reason ?? 'voided'}</Badge>}
          {txn.exclude_from_totals && <Badge tone="neutral">excluded</Badge>}
        </div>
      </td>

      <td className="w-56 py-2 align-top">
        {editing === 'category' ? (
          <div className="relative">
            <div className="absolute left-0 top-0 z-20">
              <CategoryPalette
                categories={categories}
                usage={usage}
                suggestedId={txn.suggested_category_id}
                unconfirmedId={isGuess ? txn.category_id : null}
                currentId={txn.category_id}
                onPick={(id) => {
                  setEditing(null);
                  // Picking the category the row already has is a
                  // CONFIRMATION, not a change: applyPatch would no-op and
                  // leave it unlocked, so the row would stay in the backlog
                  // after an apparent confirmation. Route it to the endpoint
                  // that flips category_source instead.
                  if (id !== null && id === txn.category_id && isGuess) {
                    void confirmGuess(txn.id);
                    return;
                  }
                  onPatch(txn.id, { category_id: id });
                }}
                onClose={() => setEditing(null)}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditing('category')}
            className="flex w-full items-center gap-2 text-left text-sm text-paper-dim transition-colors hover:text-paper"
          >
            <span className="truncate">{txn.category_name ?? 'Uncategorized'}</span>
            {/* A quiet mark, not a boxed chip. On a freshly synced ledger
                nearly every row is a machine guess, and a chip on all of them
                marks nothing. The "Needs review" filter works the backlog;
                this just says where the category came from. */}
            {isGuess && (
              <span
                className="eyebrow shrink-0 text-[9px] text-paper-faint"
                title={`Categorised by ${txn.category_source} — click to confirm or change`}
              >
                guess
              </span>
            )}
            {txn.category_locked && (
              <span className="shrink-0 text-edited" title="Set by hand — machine passes will not change it">
                ◆
              </span>
            )}
          </button>
        )}
      </td>

      <td className="w-28 py-2 text-xs">
        <span className="eyebrow" style={{ fontSize: '0.625rem' }}>
          {txn.eff_cost_type === 'fixed' ? 'fixed' : 'var'} · {abbrev(txn.eff_necessity)}
        </span>
      </td>

      <td className="w-32 py-2 pr-2 text-right">
        {editing === 'amount' ? (
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            defaultValue={(txn.eff_amount_cents / 100).toFixed(2)}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(null);
              if (e.key !== 'Enter') return;
              const parsed = parseInput(e.currentTarget.value);
              if (parsed !== null && parsed !== txn.eff_amount_cents) {
                onPatch(txn.id, { amount_cents_override: parsed });
              }
              setEditing(null);
            }}
            className="figure w-full rounded-sm border border-ink-500 bg-ink-800 px-2 py-1 text-right text-sm"
          />
        ) : (
          <button
            onClick={() => setEditing('amount')}
            className="w-full text-right"
            title={
              txn.amount_cents_override !== null
                ? `Bank reported ${formatCents(txn.amount_cents)} — corrected by hand`
                : 'Click to correct'
            }
          >
            <Figure
              cents={txn.eff_amount_cents}
              original={txn.amount_cents_override !== null ? txn.amount_cents : undefined}
              className="text-sm"
            />
          </button>
        )}
      </td>
    </tr>

    {expanded && (
      <tr className="rule-b">
        <td colSpan={6} className="p-0">
          <RowEditor
            txn={txn}
            categories={categories}
            usage={usage}
            onPatch={onPatch}
            onClose={() => setExpanded(false)}
          />
        </td>
      </tr>
    )}
    </>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'neutral' | 'out' }) {
  return (
    <span
      className={clsx(
        'rounded-sm px-1 py-px text-[10px] uppercase tracking-wide',
        tone === 'out' ? 'bg-out-dim/25 text-out' : 'bg-ink-700 text-paper-faint',
      )}
    >
      {children}
    </span>
  );
}

function abbrev(n: string): string {
  return { required: 'req', discretionary: 'disc', income: 'inc', transfer: 'xfer', investment: 'inv' }[n] ?? n;
}

/** Parses the inline amount input to signed cents. Never uses parseFloat (I1). */
function parseInput(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, '');
  if (!/^-?\d*\.?\d{0,2}$/.test(s) || s === '' || s === '-') return null;
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents === 0) return null;
  return neg ? -cents : cents;
}
