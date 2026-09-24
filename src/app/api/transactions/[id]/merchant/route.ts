/**
 * GET  — what the register knows about this row's merchant, for the edit panel.
 * POST — set this row's category, and optionally apply it to the merchant's
 *        other unreviewed rows.
 *
 * Applying to siblings is a ONE-TIME action on rows that exist now. There is
 * deliberately no standing "always file this merchant here" any more: a stored
 * default re-asserted itself on every sync and silently reverted later, more
 * specific decisions. A repeat charge is categorised by a rule or the model,
 * both of which are visible and editable; a hidden per-merchant default was
 * neither. It respects I4 by only ever touching rows that are NOT locked.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { getMerchantContext } from '@/lib/queries';
import { applyPatch, confirmCategory, EditError } from '@/lib/edit';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const merchant = await getMerchantContext(id);
  // A row with no merchant is normal, not an error — the panel omits the
  // "apply to others" block.
  return NextResponse.json({ merchant });
}

const RememberSchema = z.object({
  category_id: z.string().uuid(),
  /** Apply to this merchant's other unreviewed rows, once. */
  apply_to_siblings: z.boolean().default(false),
}).strict();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const parsed = RememberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }
  const { category_id, apply_to_siblings } = parsed.data;

  // A merchant is required only to reach this merchant's OTHER rows. This
  // route is also the confirm path — picking the category a row already has,
  // which applyPatch would no-op — and a row with no merchant must still be
  // confirmable, or the "needs review" backlog cannot be cleared for it.
  const context = await getMerchantContext(id);
  if (!context && apply_to_siblings) {
    return NextResponse.json(
      { error: 'This transaction has no merchant to apply across.' },
      { status: 400 },
    );
  }

  try {
    const transaction = await setOrConfirm(id, category_id);

    let applied = 0;
    if (apply_to_siblings && context) {
      // One patch per row rather than a bulk UPDATE: each must write its own
      // transaction_edits row (I6) and trip the lock trigger (I4).
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM v_transactions
        WHERE merchant_id = ${context.merchant_id}
          AND id <> ${id}
          AND NOT category_locked
          AND voided_at IS NULL AND superseded_by_id IS NULL`;
      for (const row of rows) {
        await setOrConfirm(row.id, category_id);
        applied += 1;
      }
    }

    return NextResponse.json({ transaction, applied });
  } catch (err) {
    if (err instanceof EditError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('POST /api/transactions/[id]/merchant failed:', err);
    return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  }
}

/**
 * Apply a category, or confirm it when the row already carries it.
 *
 * Both are human decisions and both must end with the row locked (I4). Only
 * the audit trail differs: a change logs category_id, a confirmation logs
 * category_source, because an audit row claiming old == new would be false.
 */
async function setOrConfirm(id: string, categoryId: string) {
  const [row] = await sql<{ category_id: string | null }[]>`
    SELECT category_id FROM transactions WHERE id = ${id}`;
  return row?.category_id === categoryId
    ? confirmCategory(id)
    : applyPatch(id, { category_id: categoryId });
}
