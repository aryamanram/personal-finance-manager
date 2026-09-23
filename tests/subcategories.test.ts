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
import { createTestDb, seedAccounts } from './helpers/db';
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
