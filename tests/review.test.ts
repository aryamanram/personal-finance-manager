/**
 * V3 of docs/design/OVERHAUL.md: a count is what its destination shows.
 *
 * The register's review chips once read 216 over a table of 204: the table
 * hid Credit Card Payment by default and the count did not. These assert the
 * AGREEMENT under every filter the register can apply, rather than any one
 * number — and that Review's inbox holds exactly what its nav badge counts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb } from './helpers/db';
import { fingerprint } from '@/ingest/fingerprint';
import { registerView } from '@/lib/register-filters';
import type { CategoryWithGroup } from '@/lib/types';

let sql: Sql;
let drop: () => Promise<void>;
let q: typeof import('@/lib/queries');
let accountId: string;
let categories: CategoryWithGroup[];
const cat: Record<string, string> = {};

async function insert(row: {
  description: string; amountCents: number; postedDate: string; category: string | null;
  source: 'rule' | 'history' | 'manual' | 'unset'; voided?: boolean;
}) {
  await sql`
    INSERT INTO transactions
      (account_id, raw_description, amount_cents, posted_date, status, source, fingerprint,
       category_id, category_source, voided_at, void_reason)
    VALUES (${accountId}, ${row.description}, ${row.amountCents}, ${row.postedDate}, 'posted', 'simplefin',
            ${fingerprint({ accountId, postedDate: row.postedDate, amountCents: row.amountCents, rawDescription: row.description })},
            ${row.category ? cat[row.category] : null}, ${row.source},
            ${row.voided ? new Date('2026-09-01T12:00:00Z') : null}, ${row.voided ? 'duplicate' : null})`;
}

beforeAll(async () => {
  const db = await createTestDb('review');
  sql = db.sql;
  drop = db.drop;
  process.env.DATABASE_URL = db.url;
  q = await import('@/lib/queries');
  for (const { id, name } of await sql<{ id: string; name: string }[]>`SELECT id, name FROM categories`) cat[name] = id;
  const [inst] = await sql<{ id: string }[]>`INSERT INTO institutions (name, source) VALUES ('Bank', 'simplefin') RETURNING id`;
  [{ id: accountId }] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, external_id)
    VALUES (${inst.id}, 'Checking', 'depository', 'simplefin', 'chk') RETURNING id`;

  await insert({ description: 'GROCER', amountCents: -3000, postedDate: '2026-08-03', category: 'Groceries', source: 'rule' });
  await insert({ description: 'BISTRO', amountCents: -2000, postedDate: '2026-09-04', category: 'Restaurants', source: 'history' });
  await insert({ description: 'RENT', amountCents: -100000, postedDate: '2026-09-01', category: 'Rent', source: 'manual' });
  await insert({ description: 'MYSTERY', amountCents: -1500, postedDate: '2026-09-05', category: null, source: 'unset' });
  // The 216/204 case: a guess filed as Credit Card Payment, which the
  // register hides by default.
  await insert({ description: 'CARD AUTOPAY', amountCents: -40000, postedDate: '2026-09-10', category: 'Credit Card Payment', source: 'rule' });
  // A voided guess, which shows only when voided rows are asked for.
  await insert({ description: 'GROCER DUPLICATE', amountCents: -3000, postedDate: '2026-09-11', category: 'Groceries', source: 'rule', voided: true });
  categories = await q.getCategories();
});

afterAll(async () => { await drop(); });

/** The register's filters for a URL, read the page's own way. */
const view = (query: string) => {
  const p = new URLSearchParams(query);
  return registerView((k) => p.get(k) ?? undefined, categories).filters;
};

describe('the review chips count what they would show (V3)', () => {
  it.each([
    ['the default register', ''],
    ['one month', 'from=2026-09-01&to=2026-09-30'],
    ['every category shown', 'hide=none'],
    ['voided rows included', 'voided=1'],
    ['one necessity', 'necessity=discretionary'],
    ['a search', 'q=GROCER'],
  ])('%s', async (_, query) => {
    const f = view(query);
    const counts = await q.getReviewCounts(f);
    const guesses = await q.getTransactions({ ...f, needsReviewOnly: true, limit: 1000 });
    const blank = await q.getTransactions({ ...f, uncategorizedOnly: true, limit: 1000 });
    expect(counts).toEqual({ needs_review: guesses.length, uncategorized: blank.length });
  });

  it('no longer counts the rows the default register hides', async () => {
    // Groceries and Bistro; not the hidden card payment, not the voided one.
    expect((await q.getReviewCounts(view(''))).needs_review).toBe(2);
    expect((await q.getReviewCounts(view('hide=none'))).needs_review).toBe(3);
  });

  it('counts the same whichever backlog chip is already on', async () => {
    expect(await q.getReviewCounts(view('review=1'))).toEqual(await q.getReviewCounts(view('')));
  });
});

describe("Review's inbox holds what its badge counts (V3)", () => {
  it('lists every guess and every blank, hiding no category', async () => {
    const counts = await q.getReviewCounts();
    const inbox = await q.getReviewQueue();
    expect(inbox.length).toBe(counts.needs_review + counts.uncategorized);
    expect(inbox.map((r) => r.raw_description).sort()).toEqual(['BISTRO', 'CARD AUTOPAY', 'GROCER', 'MYSTERY']);
  });

  it('narrows to a period on request', async () => {
    const inbox = await q.getReviewQueue({ from: '2026-09-01', to: '2026-09-30' });
    const counts = await q.getReviewCounts({ from: '2026-09-01', to: '2026-09-30' });
    expect(inbox.length).toBe(counts.needs_review + counts.uncategorized);
    expect(inbox.map((r) => r.raw_description)).not.toContain('GROCER');
  });
});
