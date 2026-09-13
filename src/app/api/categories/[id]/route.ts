/**
 * PATCH /api/categories/[id] — the two axes a category hands down to its
 * transactions (INGEST_NOTES.md §5).
 *
 * Changing a default shifts every transaction that has not overridden it, so
 * this changes historical totals by design: it is a correction to a
 * classification, not a new fact about the past.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';

const Body = z.object({
  default_cost_type: z.enum(['fixed', 'variable']).optional(),
  default_necessity: z
    .enum(['required', 'discretionary', 'income', 'transfer', 'investment'])
    .optional(),
  name: z.string().min(1).max(100).optional(),
}).strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid patch.' }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  }

  const [updated] = await sql<{ id: string }[]>`
    UPDATE categories SET ${sql(parsed.data)} WHERE id = ${id} RETURNING id`;

  if (!updated) return NextResponse.json({ error: 'Category not found.' }, { status: 404 });

  return NextResponse.json({ category: updated });
}
