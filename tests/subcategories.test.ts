/**
 * Subcategories: one extra level under a category, for detail without losing
 * the totals.
 *
 * The point of the design is that a subcategory is an ORDINARY category with a
 * parent. Transactions still point at exactly one category_id, so rules, the
 * LLM and the palette work on it unchanged, and anything that wants totals as
 * if the split had never happened groups by v_transactions.rollup_category_*.
 *
 * These tests assert the arithmetic of that rollup, and the two things the
 * database refuses to let a subcategory be.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb, seedAccounts, categoryByName } from './helpers/db';
import { fingerprint } from '@/ingest/fingerprint';

let sql: Sql;
let drop: () => Promise<void>;
let acct: Awaited<ReturnType<typeof seedAccounts>>;
let subsId: string;
let streamingId: string;

beforeAll(async () => {
  const db = await createTestDb('subcategories');
  sql = db.sql;
  drop = db.drop;
  acct = await seedAccounts(sql);

  // queries.ts builds its pool from DATABASE_URL at import time, so the env
  // has to point at the scratch database before it is imported.
  process.env.DATABASE_URL = db.url;

  [{ id: subsId }] = await sql<{ id: string }[]>`
    SELECT id FROM categories WHERE name = 'Subscriptions' AND parent_id IS NULL`;

  [{ id: streamingId }] = await sql<{ id: string }[]>`
    INSERT INTO categories (group_id, name, parent_id, default_cost_type, default_necessity)
    SELECT group_id, 'Streaming & Video', id, 'fixed', 'discretionary'
    FROM categories WHERE id = ${subsId}
    RETURNING id`;
}, 30_000);

afterAll(async () => { await drop(); });

/** Writes one posted row, fingerprinted the way the real ingest path does. */
async function txn(categoryId: string, amountCents: number, postedDate: string, descr: string) {
  await sql`
    INSERT INTO transactions
      (account_id, raw_description, amount_cents, posted_date, status, source,
       fingerprint, category_id, category_source)
    VALUES (${acct.appleId}, ${descr}, ${amountCents}, ${postedDate}, 'posted', 'csv',
            ${fingerprint({
              accountId: acct.appleId, postedDate, amountCents, rawDescription: descr,
            })},
            ${categoryId}, 'rule')`;
}

describe('the database refuses a subcategory that would not roll up', () => {
  it('rejects a child filed under a different group from its parent', async () => {
    // Otherwise parent and child disagree about which band of the Sankey the
    // money is in, and a rollup silently moves spending between groups.
    await expect(sql`
      INSERT INTO categories (group_id, name, parent_id)
      SELECT (SELECT id FROM category_groups WHERE name = 'Food'), 'Wrong Group', ${subsId}
    `).rejects.toThrow(/same group as its parent/);
  });

  it('rejects a third level', async () => {
    // Depth is capped at two on purpose: arbitrary nesting turns every rollup
    // into a recursive CTE and forces every UI to pick a render depth.
    await expect(sql`
      INSERT INTO categories (group_id, name, parent_id)
      SELECT group_id, 'Too Deep', ${streamingId} FROM categories WHERE id = ${streamingId}
    `).rejects.toThrow(/one level deep/);
  });

  it('rejects a category that is its own parent', async () => {
    await expect(sql`
      UPDATE categories SET parent_id = id WHERE id = ${streamingId}
    `).rejects.toThrow(/its own parent/);
  });
});

describe('rollup arithmetic', () => {
  it('reports a subcategory under its parent, and a parent under itself', async () => {
    await txn(streamingId, -1599, '2026-08-09', 'STREAMING SERVICE');
    await txn(subsId, -500, '2026-08-10', 'UNSPLIT SUBSCRIPTION');

    const rows = await sql<{
      category_name: string; rollup_category_name: string; is_subcategory: boolean;
    }[]>`
      SELECT category_name, rollup_category_name, is_subcategory
      FROM v_transactions
      WHERE raw_description IN ('STREAMING SERVICE', 'UNSPLIT SUBSCRIPTION')
      ORDER BY raw_description`;

    expect(rows).toHaveLength(2);
    // The child reports its own name, and its parent as the rollup.
    expect(rows[0]).toMatchObject({
      category_name: 'Streaming & Video',
      rollup_category_name: 'Subscriptions',
      is_subcategory: true,
    });
    // A top-level category rolls up to ITSELF, so a consumer can group by
    // rollup_* unconditionally without a special case for unsplit rows.
    expect(rows[1]).toMatchObject({
      category_name: 'Subscriptions',
      rollup_category_name: 'Subscriptions',
      is_subcategory: false,
    });
  });

  it('totals the same after a split as before it', async () => {
    // The whole promise of the design: splitting a category adds detail and
    // changes no total. A rollup that did not sum to the original would mean
    // money had moved between groups, which is a correctness bug about money.
    const [{ cents }] = await sql<{ cents: number }[]>`
      SELECT COALESCE(-SUM(eff_amount_cents), 0)::int AS cents
      FROM v_transactions
      WHERE rollup_category_name = 'Subscriptions' AND counts_as_spending`;
    expect(cents).toBe(1599 + 500);

    // And the split is real: the parent alone holds only the unsplit row.
    const [{ own }] = await sql<{ own: number }[]>`
      SELECT COALESCE(-SUM(eff_amount_cents), 0)::int AS own
      FROM v_transactions
      WHERE category_name = 'Subscriptions' AND counts_as_spending`;
    expect(own).toBe(500);
  });

  it('keeps the subcategory in its parent’s group', async () => {
    const [row] = await sql<{ category_group_name: string }[]>`
      SELECT category_group_name FROM v_transactions
      WHERE raw_description = 'STREAMING SERVICE'`;
    expect(row.category_group_name).toBe('Lifestyle');
  });
});

describe('filtering by a category includes its subcategories', () => {
  /**
   * Filtering to "Subscriptions" and seeing none of its ten children's rows
   * would be a filter that lies about the category it names — and it would
   * silently under-report, which about money is the failure that matters.
   */
  it('returns the parent\u2019s own rows AND its children\u2019s', async () => {
    const { getTransactions } = await import('@/lib/queries');
    const rows = await getTransactions({ categoryIds: [subsId] });
    const names = rows.map((r) => r.raw_description);
    expect(names).toContain('STREAMING SERVICE');     // a child's row
    expect(names).toContain('UNSPLIT SUBSCRIPTION');  // the parent's own
  });

  it('filtering to a CHILD returns only that child', async () => {
    const { getTransactions } = await import('@/lib/queries');
    const rows = await getTransactions({ categoryIds: [streamingId] });
    const names = rows.map((r) => r.raw_description);
    expect(names).toContain('STREAMING SERVICE');
    expect(names).not.toContain('UNSPLIT SUBSCRIPTION');
  });
});

describe('the card side of a card payment is not in the register', () => {
  /**
   * A card payment produces two rows: -1000 on checking and +1000 on the
   * CARD, because positive on a liability account means the debt went down.
   * They are one event, and the card leg is the useless half — the debit is
   * what proves a bill got paid.
   *
   * The rule is STRUCTURAL, not categorical: positive, on a credit account,
   * with payment-shaped text. Two of these rows were filed as "Account
   * Transfer" rather than "Credit Card Payment", so a category-name rule
   * would have missed them.
   */
  let cardId: string;

  beforeAll(async () => {
    [{ id: cardId }] = await sql<{ id: string }[]>`SELECT ${acct.explorerId}::uuid AS id`;
    const rows: [string, number, string][] = [
      ['PAYMENT THANK YOU', 100000, '2026-08-16'],     // the card leg
      ['STATEMENT CREDIT REFUND', 2500, '2026-08-18'], // a refund: NOT a payment
      ['MERCHANT PURCHASE', -4200, '2026-08-19'],      // an ordinary charge
    ];
    for (const [descr, cents, date] of rows) {
      await sql`
        INSERT INTO transactions
          (account_id, raw_description, amount_cents, posted_date, status, source, fingerprint)
        VALUES (${cardId}, ${descr}, ${cents}, ${date}, 'posted', 'csv',
                ${fingerprint({ accountId: cardId, postedDate: date, amountCents: cents, rawDescription: descr })})`;
    }
  });

  it('flags the payment leg', async () => {
    const [row] = await sql<{ is_card_payment_credit: boolean }[]>`
      SELECT is_card_payment_credit FROM v_transactions
      WHERE raw_description = 'PAYMENT THANK YOU'`;
    expect(row.is_card_payment_credit).toBe(true);
  });

  it('does NOT flag a refund, which is real money coming back', async () => {
    // Positive on a card too, but it must stay visible: a refund is money
    // returning, not a duplicate of a debit somewhere else.
    const [row] = await sql<{ is_card_payment_credit: boolean }[]>`
      SELECT is_card_payment_credit FROM v_transactions
      WHERE raw_description = 'STATEMENT CREDIT REFUND'`;
    expect(row.is_card_payment_credit).toBe(false);
  });

  it('does NOT flag an ordinary charge', async () => {
    const [row] = await sql<{ is_card_payment_credit: boolean }[]>`
      SELECT is_card_payment_credit FROM v_transactions
      WHERE raw_description = 'MERCHANT PURCHASE'`;
    expect(row.is_card_payment_credit).toBe(false);
  });

  it('keeps the payment leg out of the register by default', async () => {
    const { getTransactions } = await import('@/lib/queries');
    const shown = (await getTransactions({})).map((r) => r.raw_description);
    expect(shown).not.toContain('PAYMENT THANK YOU');
    expect(shown).toContain('STATEMENT CREDIT REFUND');
    expect(shown).toContain('MERCHANT PURCHASE');
  });

  it('can still be reached deliberately, so nothing is unreachable', async () => {
    const { getTransactions } = await import('@/lib/queries');
    const shown = (await getTransactions({ includeCardPaymentCredits: true }))
      .map((r) => r.raw_description);
    expect(shown).toContain('PAYMENT THANK YOU');
  });

  it('counts what it shows', async () => {
    // getTransactions and countTransactions must apply the same predicate,
    // or the header promises rows the table does not have.
    const { getTransactions, countTransactions } = await import('@/lib/queries');
    const rows = await getTransactions({ limit: 1000 });
    expect(await countTransactions({})).toBe(rows.length);
  });
});

describe('a review chip never promises rows the register cannot show', () => {
  /**
   * The chip is a to-do. If it counts a row the table filters out, clicking
   * it lands on an empty screen with no way to clear the number — the backlog
   * can never reach zero.
   *
   * This has broken twice: once when the counts were global and the table was
   * scoped to a period, and once when card-payment credit legs became
   * permanently invisible while still being counted. Both times the count and
   * the table disagreed about which rows exist, so the test asserts the
   * AGREEMENT rather than either number.
   */
  it('counts exactly what the needs-review filter returns', async () => {
    const { getReviewCounts, getTransactions } = await import('@/lib/queries');

    const counts = await getReviewCounts();
    const rows = await getTransactions({ needsReviewOnly: true, limit: 1000 });

    expect(counts.needs_review).toBe(rows.length);
  });

  it('counts exactly what the uncategorized filter returns', async () => {
    const { getReviewCounts, getTransactions } = await import('@/lib/queries');

    const counts = await getReviewCounts();
    const rows = await getTransactions({ uncategorizedOnly: true, limit: 1000 });

    expect(counts.uncategorized).toBe(rows.length);
  });

  it('still agrees once a hidden row would have been counted', async () => {
    // The exact regression: an unconfirmed card-payment credit leg. It is
    // machine-categorised and unlocked, so the naive count includes it, and
    // the register can never show it.
    const transferCat = await categoryByName(sql, 'Credit Card Payment');
    const descr = 'PAYMENT THANK YOU — HIDDEN LEG';
    const date = '2026-09-30';
    await sql`
      INSERT INTO transactions
        (account_id, raw_description, amount_cents, posted_date, status, source,
         fingerprint, category_id, category_source)
      VALUES (${acct.explorerId}, ${descr}, 250000, ${date}, 'posted', 'simplefin',
              ${fingerprint({ accountId: acct.explorerId, postedDate: date, amountCents: 250000, rawDescription: descr })},
              ${transferCat}, 'llm')`;

    const [{ hidden }] = await sql<{ hidden: boolean }[]>`
      SELECT is_card_payment_credit AS hidden FROM v_transactions
      WHERE raw_description = ${descr}`;
    expect(hidden).toBe(true);   // the register will not show it

    const { getReviewCounts, getTransactions } = await import('@/lib/queries');
    const counts = await getReviewCounts();
    const rows = await getTransactions({ needsReviewOnly: true, limit: 1000 });
    expect(counts.needs_review).toBe(rows.length);
  });
});
