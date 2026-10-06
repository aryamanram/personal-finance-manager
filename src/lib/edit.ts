/**
 * The manual edit contract (DESIGN.md §7).
 *
 * On every write:
 *   1. one transaction_edits row per changed field (I6)
 *   2. category_source = 'manual' when category_id changed — the DB trigger
 *      then sets category_locked (I4; never manage the flag from here)
 *   3. return the refreshed row from v_transactions, so the client gets
 *      resolved eff_* values rather than raw ones (I3)
 */
import 'server-only';
import { z } from 'zod';
import { sql } from './db';
import type { VTransaction } from './types';

const uuid = z.string().uuid();

export const TransactionPatchSchema = z.object({
  category_id: uuid.nullable().optional(),
  amount_cents_override: z.number().int().nullable().optional(),
  posted_date_override: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  cost_type_override: z.enum(['fixed', 'variable']).nullable().optional(),
  necessity_override: z
    .enum(['required', 'discretionary', 'income', 'transfer', 'investment'])
    .nullable().optional(),
  merchant_id: uuid.nullable().optional(),
  destination_account_id: uuid.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  exclude_from_totals: z.boolean().optional(),
  voided_at: z.union([z.string(), z.null()]).optional(),
  void_reason: z.string().max(500).nullable().optional(),
}).strict();

export type TransactionPatch = z.infer<typeof TransactionPatchSchema>;

/** Fields a user may edit. Anything outside this list is rejected by .strict(). */
const EDITABLE = [
  'category_id', 'amount_cents_override', 'posted_date_override', 'description',
  'cost_type_override', 'necessity_override', 'merchant_id',
  'destination_account_id', 'notes', 'exclude_from_totals', 'voided_at', 'void_reason',
] as const;

export class EditError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function applyPatch(
  id: string,
  patch: TransactionPatch,
): Promise<VTransaction> {
  const keys = Object.keys(patch).filter((k) => (EDITABLE as readonly string[]).includes(k));
  if (keys.length === 0) throw new EditError('No editable fields in request.');

  return sql.begin(async (tx) => {
    const [before] = await tx<Record<string, unknown>[]>`
      SELECT * FROM transactions WHERE id = ${id} FOR UPDATE`;
    if (!before) throw new EditError('Transaction not found.', 404);

    // An amount override of zero would contradict the schema's amount_nonzero
    // intent and silently drop the row from totals. Reject it explicitly.
    if (patch.amount_cents_override === 0) {
      throw new EditError('Amount override cannot be zero. Void the transaction instead.');
    }

    const changed: { field: string; oldValue: string | null; newValue: string | null }[] = [];
    const updates: Record<string, unknown> = {};

    for (const key of keys) {
      const next = (patch as Record<string, unknown>)[key];
      const prev = before[key];
      if (same(prev, next)) continue;   // no-op, no log row
      updates[key] = next;
      changed.push({ field: key, oldValue: str(prev), newValue: str(next) });
    }

    if (changed.length === 0) {
      const [unchanged] = await tx<VTransaction[]>`SELECT * FROM v_transactions WHERE id = ${id}`;
      return unchanged;
    }

    // A category change is a human decision. Setting category_source='manual'
    // makes the trigger set category_locked — do not set the lock here.
    if ('category_id' in updates) updates.category_source = 'manual';

    // Voiding always wants a reason; the ledger is unreadable without one.
    if (updates.voided_at && !patch.void_reason && !before.void_reason) {
      updates.void_reason = 'Voided manually';
    }
    if (updates.voided_at === null) updates.void_reason = null;

    await tx`UPDATE transactions SET ${tx(updates)} WHERE id = ${id}`;

    // I6: one row per changed field, the audit trail and basis for undo.
    for (const c of changed) {
      await tx`
        INSERT INTO transaction_edits (transaction_id, field, old_value, new_value)
        VALUES (${id}, ${c.field}, ${c.oldValue}, ${c.newValue})`;
    }

    // I3: return the resolved view row, not the base table.
    const [after] = await tx<VTransaction[]>`SELECT * FROM v_transactions WHERE id = ${id}`;
    return after;
  });
}

/**
 * Undo: null out an override and log the revert as another edit, so history is
 * append-only and the audit trail never loses a step (DESIGN.md §7).
 */
export async function revertField(id: string, field: string): Promise<VTransaction> {
  const REVERTABLE = [
    'amount_cents_override', 'posted_date_override', 'description',
    'cost_type_override', 'necessity_override', 'notes',
  ];
  if (!REVERTABLE.includes(field)) {
    throw new EditError(`Field "${field}" cannot be reverted.`);
  }
  return applyPatch(id, { [field]: null } as TransactionPatch);
}

/**
 * Confirm a machine's category without changing it.
 *
 * "I agree with the guess" is a decision, but it changes no value, so
 * applyPatch treats it as a no-op and returns early — correct for I6, which
 * must not log an edit that edited nothing. What it does change is provenance:
 * category_source becomes 'manual', the trigger sets category_locked, and the
 * recategorizer stops revisiting the row (I4).
 *
 * Without this the "needs review" backlog is unclearable whenever you agree
 * with the machine, which is the common case — every row in a freshly synced
 * ledger is a machine guess.
 *
 * Logged under its own field name rather than as a category_id edit: nothing
 * about the category changed, and an audit row claiming old == new would make
 * the history lie.
 */
export async function confirmCategory(id: string): Promise<VTransaction> {
  return sql.begin(async (tx) => {
    const [before] = await tx<Record<string, unknown>[]>`
      SELECT id, category_id, category_source, category_locked
      FROM transactions WHERE id = ${id} FOR UPDATE`;
    if (!before) throw new EditError('Transaction not found.', 404);
    if (before.category_id === null) {
      throw new EditError('Nothing to confirm — this row has no category.');
    }

    // Already a human decision; confirming again would log a second edit for
    // no change.
    if (before.category_locked) {
      const [row] = await tx<VTransaction[]>`SELECT * FROM v_transactions WHERE id = ${id}`;
      return row;
    }

    await tx`UPDATE transactions SET category_source = 'manual' WHERE id = ${id}`;
    await tx`
      INSERT INTO transaction_edits (transaction_id, field, old_value, new_value)
      VALUES (${id}, 'category_source', ${str(before.category_source)}, 'manual')`;

    const [after] = await tx<VTransaction[]>`SELECT * FROM v_transactions WHERE id = ${id}`;
    return after;
  });
}

/** Bulk category assignment. A bulk edit IS a manual edit — it sets the lock. */
/**
 * Assigns a category to many rows, as a human decision.
 *
 * This is CONFIRM, not change. Picking the category a row already has is the
 * commonest bulk action there is — a screen of machine guesses that happen to
 * be right — and it is a real edit: category_source goes to 'manual' and the
 * trigger sets category_locked, which is what stops the next rules or guess
 * pass overwriting the row (I4) and what clears the GUESS badge.
 *
 * Skipping rows whose category_id already matched made exactly that case a
 * silent no-op: select forty correct guesses, pick their own category, and
 * nothing happened — no error, no change, still unconfirmed. The only rows
 * worth skipping are the ones already manually set to this category, where
 * there is genuinely nothing left to decide.
 */
export async function bulkSetCategory(ids: string[], categoryId: string): Promise<number> {
  if (ids.length === 0) return 0;

  return sql.begin(async (tx) => {
    const rows = await tx<
      { id: string; category_id: string | null; category_source: string; category_locked: boolean }[]
    >`
      SELECT id, category_id, category_source::text, category_locked
      FROM transactions WHERE id = ANY(${ids}::uuid[])`;

    const toChange = rows.filter(
      (r) => r.category_id !== categoryId || !r.category_locked,
    );
    if (toChange.length === 0) return 0;

    await tx`
      UPDATE transactions SET category_id = ${categoryId}, category_source = 'manual'
      WHERE id = ANY(${toChange.map((r) => r.id)}::uuid[])`;

    for (const r of toChange) {
      // A confirmation is not a category change, so it is logged as what it
      // actually was — otherwise the edit history reads as forty edits that
      // each set a field to the value it already held.
      if (r.category_id !== categoryId) {
        await tx`
          INSERT INTO transaction_edits (transaction_id, field, old_value, new_value)
          VALUES (${r.id}, 'category_id', ${r.category_id}, ${categoryId})`;
      } else {
        await tx`
          INSERT INTO transaction_edits (transaction_id, field, old_value, new_value)
          VALUES (${r.id}, 'category_source', ${r.category_source}, 'manual')`;
      }
    }
    return toChange.length;
  });
}

/** Dates arrive as ISO strings from the view and Date objects from the table. */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v === null || v === undefined) return ' null';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  };
  return norm(a) === norm(b);
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
