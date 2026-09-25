'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Figure } from './Figure';
import { RowEditor } from './RowEditor';
import { formatCents } from '@/money';
import { formatRegisterDate } from '@/lib/format-date';
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
  onConfirm,
  pending,
  repeatsDate,
}: {
  txn: VTransaction;
  categories: CategoryWithGroup[];
  selected: boolean;
  /** The row above shares this date, so printing it again says nothing. */
  repeatsDate?: boolean;
  /** Dates in this year print without one; others carry a short year. */
  /** `extend` is shift-click: take every row between the last one and this. */
  onSelect: (id: string, on: boolean, extend?: boolean) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  /** Lock the category the row already has — agreeing with the machine. */
  onConfirm: (id: string) => void;
  pending?: boolean;
}) {
  const [editing, setEditing] = useState<null | 'amount'>(null);
  const [expanded, setExpanded] = useState(false);
  const editorRef = useRef<HTMLTableRowElement>(null);

  // Opening a row near the bottom of the viewport put the editor below the
  // fold, so setting a category meant scrolling to find the panel you had
  // just opened.
  //
  // scrollIntoView's block options are not enough here. 'nearest' stops as
  // soon as the top edge shows, leaving the category button off screen, and
  // 'end' aligns to the viewport bottom without accounting for the sticky
  // header above. So compute the target directly: scroll only as far as it
  // takes to fit the panel, and leave it alone when it already fits.
  useEffect(() => {
    if (!expanded) return;
    const el = editorRef.current;
    if (!el) return;

    // Measure after paint. On the tick the effect first runs, the editor row
    // has not been laid out yet, so its height reads as 0 and nothing scrolls.
    const id = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const HEADER = 64;   // the sticky nav, which overlays the top of the page
      const MARGIN = 12;
      const overflowBelow = r.bottom - (window.innerHeight - MARGIN);
      const overflowAbove = HEADER + MARGIN - r.top;

      // Never scroll so far that the panel's own top slips under the header.
      const delta = overflowBelow > 0
        ? Math.min(overflowBelow, r.top - HEADER - MARGIN)
        : overflowAbove > 0 ? -overflowAbove : 0;

      if (delta !== 0) window.scrollBy({ top: delta, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [expanded]);
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
          // shiftKey is readable on click but not on change, so the range
          // gesture has to be captured here and the change left to fire.
          onClick={(e) => {
            if (e.shiftKey) {
              onSelect(txn.id, !selected, true);
              e.preventDefault();
            }
          }}
          onChange={(e) => onSelect(txn.id, e.target.checked)}
          aria-label={`Select ${txn.eff_description}`}
          className="accent-edited"
        />
      </td>

      <td className="figure w-20 py-2 text-xs text-paper-faint">
        {/* The register is sorted by date and averages 1.7 rows per date, so
            a repeat is the same string twice in a column. The row still knows
            its date — the title and the expanded editor both carry it. */}
        <span
          className={clsx(
            txn.posted_date_override && 'edited',
            repeatsDate && !txn.posted_date_override && 'invisible',
          )}
          title={
            txn.posted_date_override
              ? `Bank reported ${txn.posted_date} — corrected by hand`
              : txn.eff_posted_date
          }
        >
          {formatRegisterDate(txn.eff_posted_date)}
        </span>
      </td>

      <td className="py-2 pr-3 align-top">
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={`${txn.account_name} · ${txn.eff_posted_date}`}
          className="block w-full text-left"
        >
          {/* Badges sit INLINE with the description rather than on their own
              line. Given to a line of their own they made the 9 rows that
              carry one 54px tall against 41px everywhere else, and an uneven
              row rhythm reads as disorder even when each row is clean. */}
          <span className="flex items-baseline gap-2">
            <span className={clsx('truncate text-sm', voided && 'line-through')}>
              {txn.eff_description}
            </span>
            {txn.status === 'pending' && <Badge tone="neutral">pending</Badge>}
            {txn.transfer_id && <Badge tone="neutral">transfer</Badge>}
            {voided && <Badge tone="out">{txn.void_reason ?? 'voided'}</Badge>}
            {txn.exclude_from_totals && <Badge tone="neutral">excluded</Badge>}
          </span>
          {/* The bank's own string, kept visible under the rename (I2). */}
          {renamed && (
            <span className="figure mt-0.5 block truncate text-xs text-paper-faint">
              {txn.raw_description}
            </span>
          )}
        </button>

      </td>

      <td className="w-56 py-2 align-top">
        {/* Opens the expanded editor rather than anchoring a palette here.
            The table scrolls (overflow-x-auto forces overflow-y: auto), and an
            absolutely-positioned 340px panel on a row near the bottom extends
            past the scrollport and gets clipped. In the editor the palette is
            in normal flow, and the row's other decisions — renaming,
            remembering the merchant — are in reach at the same time. */}
        <div className="flex w-full items-center gap-2">
        <button
          onClick={() => setExpanded(true)}
          className="flex min-w-0 items-center gap-2 text-left text-sm text-paper-dim transition-colors hover:text-paper"
        >
          <span className="truncate">{txn.category_name ?? 'Uncategorized'}</span>
        </button>

        {/* Quick-accept. The commonest review action by far is "the machine
            got it right", and routing that through the editor is four
            interactions — open, open the palette, find the category it
            already has, pick it — to change nothing but the lock.
            
            It replaces the old "guess" label rather than sitting next to it:
            the label said where the category came from, which this says too
            by being present at all. */}
        {isGuess && (
          <button
            onClick={() => onConfirm(txn.id)}
            disabled={pending}
            title={`Categorised by ${txn.category_source} — click to confirm`}
            aria-label={`Confirm ${txn.category_name} for ${txn.eff_description}`}
            className="eyebrow shrink-0 rounded-sm border border-ink-600 px-1.5 py-0.5 text-[9px] text-paper-faint transition-colors hover:border-edited hover:text-edited disabled:opacity-40"
          >
            accept
          </button>
        )}

        <div className="flex items-center gap-2">
          {/* The fixed/variable and required/discretionary axes used to have a
              column of their own, restating what the category already implies
              on all 396 rows. They only carry information when a human has
              overridden them for one transaction — which is exactly the case
              amber marks. */}
          {(txn.cost_type_override || txn.necessity_override) && (
            <span
              className="eyebrow shrink-0 text-[9px] text-edited"
              title={`Overridden by hand: ${txn.eff_cost_type} · ${abbrev(txn.eff_necessity)}`}
            >
              {txn.eff_cost_type === 'fixed' ? 'fixed' : 'var'} · {abbrev(txn.eff_necessity)}
            </span>
          )}
          {txn.category_locked && (
            <span className="shrink-0 text-edited" title="Set by hand — machine passes will not change it">
              ◆
            </span>
          )}
        </div>
        </div>
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
      <tr ref={editorRef} className="rule-b">
        <td colSpan={5} className="p-0">
          <RowEditor
            txn={txn}
            categories={categories}
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
