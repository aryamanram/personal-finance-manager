/**
 * POST /api/transactions/bulk — bulk category assignment.
 * A bulk edit is a manual edit: it sets category_source='manual' and therefore
 * the lock, exactly as a single edit would.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bulkSetCategory } from '@/lib/edit';

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  category_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected { ids: uuid[], category_id: uuid }.' },
      { status: 400 },
    );
  }

  try {
    const updated = await bulkSetCategory(parsed.data.ids, parsed.data.category_id);
    return NextResponse.json({ updated });
  } catch (err) {
    console.error('bulk update failed:', err);
    return NextResponse.json({ error: 'Bulk update failed.' }, { status: 500 });
  }
}
