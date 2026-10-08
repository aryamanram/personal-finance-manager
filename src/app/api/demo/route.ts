/**
 * GET /api/demo — the demo server says which database it is reading.
 *
 * Only under npm run dev:demo (LEDGER_DEMO=1). The visual tests ask this
 * before photographing anything, because their baselines are public: a page
 * that merely looks synthetic is not proof, the server's own connection is.
 * On the real app it is a 404 and says nothing.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.LEDGER_DEMO !== '1') return new NextResponse(null, { status: 404 });
  const [{ db }] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
  return NextResponse.json({ database: db });
}
