/**
 * Confirming a machine's guess is a decision, and must lock the row (I4).
 *
 * The register's "needs review" backlog is cleared by agreeing with the
 * machine at least as often as by overriding it — every row in a freshly
 * synced ledger arrives as a model guess. applyPatch deliberately no-ops when
 * a field is unchanged (correct for I6), which meant picking the category the
 * row already had left category_source = 'llm' and the row unlocked, so the
 * next recategorize pass was free to change it back and the backlog never
 * shrank.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb, seedAccounts, categoryByName } from './helpers/db';

let sql: Sql;
let drop: () => Promise<void>;
let edit: typeof import('@/lib/edit');
let guessedId: string;
let groceries: string;

beforeAll(async () => {
  const db = await createTestDb('confirm');
  sql = db.sql;
  drop = db.drop;
  const acct = await seedAccounts(sql);

  process.env.DATABASE_URL = buildUrl(sql);
  edit = await import('@/lib/edit');

  const { upsertTransactions } = await import('@/ingest/upsert');
  await upsertTransactions(sql, [{
    accountId: acct.explorerId,
    amountCents: -4210,
    postedDate: '2026-08-11',
    status: 'posted',
    rawDescription: 'SUPERMARKET 2891',
    source: 'simplefin',
    externalId: 'confirm-1',
  }]);

  groceries = await categoryByName(sql, 'Groceries');

  // As the LLM pass leaves it: categorised, unconfirmed, unlocked.
  const [row] = await sql<{ id: string }[]>`
    UPDATE transactions SET category_id = ${groceries}, category_source = 'llm'
    WHERE external_id = 'confirm-1' RETURNING id`;
  guessedId = row.id;
}, 30_000);

afterAll(async () => { await drop(); });

function buildUrl(s: Sql): string {
  const o = (s as unknown as { options: { host: string[]; port: number[]; database: string; user: string; pass: string } }).options;
  return `postgres://${o.user}:${o.pass}@${o.host[0]}:${o.port[0]}/${o.database}`;
}

describe('confirming a machine guess', () => {
  it('starts as an unlocked model assignment', async () => {
    const [row] = await sql<{ category_source: string; category_locked: boolean }[]>`
      SELECT category_source, category_locked FROM transactions WHERE id = ${guessedId}`;
    expect(row.category_source).toBe('llm');
    expect(row.category_locked).toBe(false);
  });

  it('applyPatch alone cannot confirm it — the value is unchanged', async () => {
    await edit.applyPatch(guessedId, { category_id: groceries });

    const [row] = await sql<{ category_source: string; category_locked: boolean }[]>`
      SELECT category_source, category_locked FROM transactions WHERE id = ${guessedId}`;
    // Documents WHY confirmCategory exists rather than asserting a wish: a
    // no-op patch writes nothing, so the row is still the machine's.
    expect(row.category_source).toBe('llm');
    expect(row.category_locked).toBe(false);
  });

  it('locks the row and keeps the category', async () => {
    const after = await edit.confirmCategory(guessedId);

    expect(after.category_id).toBe(groceries);
    expect(after.category_source).toBe('manual');
    expect(after.category_locked).toBe(true);
  });

  it('logs exactly one edit row, naming the field that actually changed', async () => {
    const rows = await sql<{ field: string; old_value: string; new_value: string }[]>`
      SELECT field, old_value, new_value FROM transaction_edits
      WHERE transaction_id = ${guessedId} ORDER BY id`;

    // One row, not two: the no-op patch above must not have logged anything.
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe('category_source');
    expect(rows[0].old_value).toBe('llm');
    expect(rows[0].new_value).toBe('manual');
  });

  it('is idempotent — confirming a locked row logs nothing further', async () => {
    await edit.confirmCategory(guessedId);

    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM transaction_edits
      WHERE transaction_id = ${guessedId}`;
    expect(c).toBe(1);
  });

  it('refuses a row with no category to confirm', async () => {
    const [row] = await sql<{ id: string }[]>`
      UPDATE transactions SET category_id = NULL, category_source = 'unset',
                              category_locked = FALSE
      WHERE external_id = 'confirm-1' RETURNING id`;
    await expect(edit.confirmCategory(row.id)).rejects.toThrow(/no category/i);
  });
});
