/**
 * POST /api/transactions/earlier — the register's next batch as it scrolls.
 *
 * Takes the very filters the page rendered its first batch with, and the
 * last row it shows, and returns the rows after that one in the register's
 * order (getTransactions, `after`). A read, but POST: the filters are a
 * structure, and putting them back through the URL would mean re-deriving
 * them a second way.
 *
 * The schema is strict on purpose. A filter it does not know would otherwise
 * be stripped, and the next batch would quietly be rows the register's
 * filter excludes.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTransactions } from '@/lib/queries';

const ids = z.array(z.string().uuid()).max(500).optional();
const flag = z.boolean().optional();

const Filters = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  accountIds: ids,
  categoryIds: ids,
  excludeCategoryIds: ids,
  leafCategoryIds: ids,
  merchantIds: ids,
  creditsOnly: flag,
  necessity: z.array(z.string().max(40)).max(10).optional(),
  costType: z.array(z.string().max(40)).max(10).optional(),
  search: z.string().max(500).optional(),
  uncategorizedOnly: flag,
  needsReviewOnly: flag,
  includeVoided: flag,
  includeCardPaymentCredits: flag,
  includeTransfers: flag,
}).strict();

const Body = z.object({
  filters: Filters,
  after: z.string().uuid(),
  limit: z.number().int().min(1).max(500),
}).strict();

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { filters, after: uuid, limit }.' }, { status: 400 });
  }
  const { filters, after, limit } = parsed.data;
  try {
    const rows = await getTransactions({ ...filters, after, limit });
    return NextResponse.json({ rows });
  } catch (err) {
    console.error('loading earlier transactions failed:', err);
    return NextResponse.json({ error: 'Could not load earlier transactions.' }, { status: 500 });
  }
}
