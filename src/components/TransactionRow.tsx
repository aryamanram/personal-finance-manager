'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Figure } from './Figure';
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
  selected,
  onSelect,
  onPatch,
  pending,
}: {
  txn: VTransaction;
  categories: CategoryWithGroup[];
  selected: boolean;
  onSelect: (id: string, on: boolean) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  pending?: boolean;
}) {
  const [editing, setEditing] = useState<null | 'category' | 'amount'>(null);
  const voided = txn.voided_at !== null;

  return (
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

      <td className="py-2 pr-3">
        <div className={clsx('truncate text-sm', voided && 'line-through')}>
          {txn.eff_description}
        </div>
        <div className="flex items-center gap-2 text-xs text-paper-faint">
          <span>{txn.account_name}</span>
          {txn.status === 'pending' && <Badge tone="neutral">pending</Badge>}
          {txn.transfer_id && <Badge tone="neutral">transfer</Badge>}
          {voided && <Badge tone="out">{txn.void_reason ?? 'voided'}</Badge>}
          {txn.exclude_from_totals && <Badge tone="neutral">excluded</Badge>}
        </div>
      </td>

      <td className="w-56 py-2">
        {editing === 'category' ? (
          <select
            autoFocus
            defaultValue={txn.category_id ?? ''}
            onBlur={() => setEditing(null)}
            onChange={(e) => {
              onPatch(txn.id, { category_id: e.target.value || null });
              setEditing(null);
            }}
            className="w-full rounded-sm border border-ink-500 bg-ink-800 px-2 py-1 text-sm"
          >
            <option value="">—</option>
            {groupBy(categories).map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setEditing('category')}
            className="flex w-full items-center gap-2 text-left text-sm text-paper-dim transition-colors hover:text-paper"
          >
            <span className="truncate">{txn.category_name ?? 'Uncategorized'}</span>
            {txn.category_locked && (
              <span className="text-edited" title="Set by hand — machine passes will not change it">
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

function groupBy(categories: CategoryWithGroup[]): [string, CategoryWithGroup[]][] {
  const map = new Map<string, CategoryWithGroup[]>();
  for (const c of categories) {
    const g = map.get(c.group_name);
    if (g) g.push(c);
    else map.set(c.group_name, [c]);
  }
  return Array.from(map);
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
