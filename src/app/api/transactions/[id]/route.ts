/**
 * PATCH /api/transactions/[id] — the manual edit endpoint (DESIGN.md §7).
 * Returns the refreshed row from v_transactions so the client has resolved
 * eff_* values to reconcile its optimistic update against.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyPatch, TransactionPatchSchema, EditError } from '@/lib/edit';
import { getTransaction, getEditHistory } from '@/lib/queries';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [txn, history] = await Promise.all([getTransaction(id), getEditHistory(id)]);
  if (!txn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ transaction: txn, history });
}

export async function PATCH(
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

  const parsed = TransactionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid patch.', issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const transaction = await applyPatch(id, parsed.data);
    return NextResponse.json({ transaction });
  } catch (err) {
    if (err instanceof EditError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('PATCH /api/transactions failed:', err);
    return NextResponse.json({ error: 'Update failed.' }, { status: 500 });
  }
}
