/**
 * DELETE /api/income-sources/[id] — stop treating a payer as known.
 *
 * Retired, not deleted (I5). The deposits it filed go back to being guesses,
 * so they reappear in review rather than silently keeping a category nobody
 * confirmed.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { runCategorization } from '@/categorize/run';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Income source not found.' }, { status: 404 });
  }
  const [row] = await sql<{ id: string }[]>`
    UPDATE income_sources SET is_active = FALSE WHERE id = ${id} AND is_active RETURNING id`;
  if (!row) return NextResponse.json({ error: 'Income source not found.' }, { status: 404 });

  await runCategorization(sql);
  return NextResponse.json({ retired: row.id });
}
