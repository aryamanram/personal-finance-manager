/**
 * POST /api/income-sources — "money from this payer is always X".
 *
 * Applied at once: the whole ledger is re-categorised so deposits already
 * waiting in review are filed now, not at the next sync. Locked rows are
 * never touched (I4), so a deposit filed by hand keeps its category.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { runCategorization } from '@/categorize/run';

const Body = z.object({
  name: z.string().trim().min(1).max(100),
  match_payer: z.string().trim().min(3).max(200).nullable().optional(),
  match_originator_id: z.string().trim().regex(/^[A-Za-z0-9]{3,20}$/).nullable().optional(),
  category_id: z.string().uuid(),
}).refine((b) => b.match_payer || b.match_originator_id, {
  message: 'Give the payer text or an originator ID.',
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Expected { name, match_payer, category_id }.' },
      { status: 400 },
    );
  }
  const b = parsed.data;

  // An income category, not merely a live one. A source files deposits as
  // KNOWN and keeps them out of review, so a spending category here would
  // silently book every paycheck as negative spending.
  const [category] = await sql<{ id: string }[]>`
    SELECT id FROM categories
    WHERE id = ${b.category_id} AND NOT is_archived AND default_necessity = 'income'`;
  if (!category) {
    return NextResponse.json({ error: 'Income category not found.' }, { status: 404 });
  }

  const [clash] = await sql<{ id: string }[]>`
    SELECT id FROM income_sources WHERE is_active AND lower(name) = lower(${b.name})`;
  if (clash) {
    return NextResponse.json({ error: `A source named ${b.name} already exists.` }, { status: 409 });
  }

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO income_sources (name, match_payer, match_originator_id, category_id)
    VALUES (${b.name}, ${b.match_payer ?? null}, ${b.match_originator_id ?? null}, ${b.category_id})
    RETURNING id`;

  const report = await runCategorization(sql);
  return NextResponse.json({ id: row.id, filed: report.byIncomeSource });
}
