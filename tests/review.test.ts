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

describe('the register pages through a day without repeating or skipping a row', () => {
  it('orders rows from one batch, and pages them exactly once each', async () => {
    // One transaction, so every row has the same created_at — as a sync's
    // batch does — and inserted backwards, so insertion order is not the answer.
    const names = ['FERRY', 'EMPORIUM', 'DELI', 'CINEMA', 'BAKERY', 'ARCADE', 'GARAGE'].sort().reverse();
    await sql.begin(async (tx) => {
      for (const [i, name] of names.entries()) {
        await tx`
          INSERT INTO transactions
            (account_id, raw_description, amount_cents, posted_date, status, source, fingerprint,
             category_id, category_source)
          VALUES (${accountId}, ${name}, ${-(100 + i)}, '2026-07-15', 'posted', 'simplefin',
                  ${fingerprint({ accountId, postedDate: '2026-07-15', amountCents: -(100 + i), rawDescription: name })},
                  ${cat.Groceries}, 'manual')`;
      }
    });
    const day = { from: '2026-07-15', to: '2026-07-15' };
    const pages = [];
    for (let offset = 0; offset < names.length; offset += 3) {
      pages.push(...(await q.getTransactions({ ...day, limit: 3, offset })));
    }
    expect(pages.map((r) => r.raw_description)).toEqual([...names].sort());
    expect(new Set(pages.map((r) => r.id)).size).toBe(names.length);
  });
});

describe('the register loads the next batch by the last row shown', () => {
  /** A day of rows, one batch from a sync: the same created_at, to the microsecond. */
  async function day(date: string, names: string[]) {
    await sql.begin(async (tx) => {
      for (const [i, name] of names.entries()) {
        await tx`
          INSERT INTO transactions
            (account_id, raw_description, amount_cents, posted_date, status, source, fingerprint,
             category_id, category_source)
          VALUES (${accountId}, ${name}, ${-(200 + i)}, ${date}, 'posted', 'simplefin',
                  ${fingerprint({ accountId, postedDate: date, amountCents: -(200 + i), rawDescription: name })},
                  ${cat.Groceries}, 'manual')`;
      }
    });
  }
  const names = (rs: { raw_description: string }[]) => rs.map((r) => r.raw_description);

  it('skips nothing when a row already shown is voided', async () => {
    const june = { from: '2026-06-01', to: '2026-06-30' };
    await day('2026-06-20', ['J1', 'J2', 'J3', 'J4']);
    await day('2026-06-10', ['K1', 'K2', 'K3']);
    const first = await q.getTransactions({ ...june, limit: 3 });
    expect(names(first)).toEqual(['J1', 'J2', 'J3']);
    await sql`UPDATE transactions SET voided_at = now(), void_reason = 'duplicate' WHERE raw_description = 'J1'`;
    // An offset of 3 would now start at K1, and J4 would never be shown.
    const next = await q.getTransactions({ ...june, limit: 3, after: first[2].id });
    expect(names(next)).toEqual(['J4', 'K1', 'K2']);
    expect(names(await q.getTransactions({ ...june, limit: 3, after: next[2].id }))).toEqual(['K3']);
  });

  it('repeats nothing when a newer row syncs in between batches', async () => {
    const may = { from: '2026-05-01', to: '2026-05-31' };
    await day('2026-05-20', ['L1', 'L2', 'L3', 'L4']);
    await day('2026-05-10', ['M1', 'M2', 'M3']);
    const first = await q.getTransactions({ ...may, limit: 3 });
    expect(names(first)).toEqual(['L1', 'L2', 'L3']);
    await day('2026-05-25', ['NEWER']);
    // An offset of 3 would now start at L3, showing it twice.
    const next = await q.getTransactions({ ...may, limit: 3, after: first[2].id });
    expect(names(next)).toEqual(['L4', 'M1', 'M2']);
  });

  it('serves each batch through the endpoint with exactly the filters the register read', async () => {
    const { POST } = await import('@/app/api/transactions/earlier/route');
    const ask = (body: unknown) => POST(new Request('http://localhost/api/transactions/earlier', {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    }));
    const [anyRow] = await q.getTransactions({ limit: 1 });
    // Every view the register can open, as the page hands it to the table.
    for (const query of [
      '', 'from=2026-09-01&to=2026-09-30', 'hide=none', 'voided=1', 'necessity=discretionary', 'q=GROCER',
      'review=1', 'uncategorized=1', `category=${cat.Groceries}&sub=1`, `category=${cat.Groceries}`,
      'credits=1', `account=${accountId}`,
    ]) {
      const p = new URLSearchParams(query);
      const { filters } = registerView((k) => p.get(k) ?? undefined, categories);
      const res = await ask({ filters: JSON.parse(JSON.stringify(filters)), after: anyRow.id, limit: 5 });
      expect(res.status, query || 'the default register').toBe(200);
    }
    // A filter it does not know is refused, not dropped: dropping it would
    // load rows the register's own filter excludes.
    const res = await ask({ filters: { somethingNew: true }, after: anyRow.id, limit: 5 });
    expect(res.status).toBe(400);
  });
});
