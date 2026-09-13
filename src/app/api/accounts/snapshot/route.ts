/**
 * POST /api/accounts/snapshot — record an investment account's value.
 *
 * A snapshot, deliberately not a transaction (DESIGN.md §13). A 6% month is
 * not a paycheck, so this must never reach v_monthly_cashflow.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { parseCents } from '@/money';

const Body = z.object({
  account_id: z.string().uuid(),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.union([z.string(), z.number()]),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { account_id, as_of, amount }.' }, { status: 400 });
  }

  let cents: number;
  try {
    cents = parseCents(parsed.data.amount);
  } catch {
    return NextResponse.json({ error: 'Could not read that amount.' }, { status: 400 });
  }

  const [account] = await sql<{ type: string }[]>`
    SELECT type FROM accounts WHERE id = ${parsed.data.account_id}`;
  if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO balance_snapshots (account_id, as_of, balance_cents, source, note)
    VALUES (${parsed.data.account_id}, ${parsed.data.as_of}, ${cents}, 'manual',
            ${parsed.data.note ?? null})
    ON CONFLICT (account_id, as_of)
      DO UPDATE SET balance_cents = EXCLUDED.balance_cents, note = EXCLUDED.note
    RETURNING id`;

  return NextResponse.json({ id: row.id, balance_cents: cents });
}
