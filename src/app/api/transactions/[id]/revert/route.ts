/**
 * POST /api/transactions/[id]/revert — undo one override.
 * Nulls the field and logs the revert as another edit, so history is
 * append-only (DESIGN.md §7).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revertField, EditError } from '@/lib/edit';

const Body = z.object({ field: z.string().min(1) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { field }.' }, { status: 400 });
  }

  try {
    const transaction = await revertField(id, parsed.data.field);
    return NextResponse.json({ transaction });
  } catch (err) {
    if (err instanceof EditError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('revert failed:', err);
    return NextResponse.json({ error: 'Revert failed.' }, { status: 500 });
  }
}
