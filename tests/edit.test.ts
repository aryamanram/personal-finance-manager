/**
 * M6 acceptance: editing an amount changes the dashboard totals, and
 * transactions.amount_cents is unchanged in the database.
 *
 * Exercises lib/edit.ts against a scratch DB by pointing DATABASE_URL at it
 * before the module (which builds its pool at import time) is loaded.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb, seedAccounts, categoryByName } from './helpers/db';

let sql: Sql;
let drop: () => Promise<void>;
let acct: Awaited<ReturnType<typeof seedAccounts>>;
let edit: typeof import('@/lib/edit');
let queries: typeof import('@/lib/queries');
let txnId: string;

beforeAll(async () => {
  const db = await createTestDb('edit');
  sql = db.sql;
  drop = db.drop;
  acct = await seedAccounts(sql);

  // Point the app's pool at this scratch DB, then import the module under test.
  process.env.DATABASE_URL = (sql as unknown as { options: { host: string[]; port: number[]; database: string; user: string; pass: string } }).options
    ? buildUrl(sql)
    : process.env.DATABASE_URL!;
  edit = await import('@/lib/edit');
  queries = await import('@/lib/queries');

  const { upsertTransactions } = await import('@/ingest/upsert');
  await upsertTransactions(sql, [{
    accountId: acct.explorerId,
    amountCents: -8712,
    postedDate: '2026-08-09',
    status: 'posted',
    rawDescription: 'WHOLE FOODS MKT 10234',
    source: 'simplefin',
    externalId: 'edit-1',
  }]);

  const groceries = await categoryByName(sql, 'Groceries');
  const [row] = await sql<{ id: string }[]>`
    UPDATE transactions SET category_id = ${groceries}, category_source = 'rule'
    WHERE external_id = 'edit-1' RETURNING id`;
  txnId = row.id;
}, 30_000);

afterAll(async () => { await drop(); });

function buildUrl(s: Sql): string {
  const o = (s as unknown as { options: { host: string[]; port: number[]; database: string; user: string; pass: string } }).options;
  return `postgres://${o.user}:${o.pass}@${o.host[0]}:${o.port[0]}/${o.database}`;
}

describe('I2 — raw values survive an edit', () => {
  it('writes an override and leaves amount_cents untouched', async () => {
    const before = await monthTotal();

    const updated = await edit.applyPatch(txnId, { amount_cents_override: -5000 });

    // The view resolves to the corrected value...
    expect(updated.eff_amount_cents).toBe(-5000);
    expect(updated.is_amount_or_date_edited).toBe(true);
    // ...while the bank's own number is preserved for reconciliation.
    expect(updated.amount_cents).toBe(-8712);

    const [raw] = await sql<{ amount_cents: number }[]>`
      SELECT amount_cents FROM transactions WHERE id = ${txnId}`;
    expect(raw.amount_cents).toBe(-8712);

    // M6: the dashboard total moves.
    const after = await monthTotal();
    expect(after).not.toBe(before);
    expect(before - after).toBe(3712);
  });

  it('rejects a zero override rather than silently dropping the row', async () => {
    await expect(edit.applyPatch(txnId, { amount_cents_override: 0 }))
      .rejects.toThrow(/cannot be zero/i);
  });
});

describe('I6 — every manual edit writes an edit row', () => {
  it('logs one row per changed field with old and new values', async () => {
    const rows = await sql<{ field: string; old_value: string; new_value: string }[]>`
      SELECT field, old_value, new_value FROM transaction_edits
      WHERE transaction_id = ${txnId} ORDER BY id`;

    const amountEdit = rows.find((r) => r.field === 'amount_cents_override');
    expect(amountEdit).toBeDefined();
    expect(amountEdit!.old_value).toBeNull();
    expect(amountEdit!.new_value).toBe('-5000');
  });

  it('writes one row per field on a multi-field patch', async () => {
    const before = await editCount();
    await edit.applyPatch(txnId, {
      description: 'Groceries for the week',
      notes: 'split with roommate',
    });
    expect(await editCount()).toBe(before + 2);
  });

  it('does not log a no-op', async () => {
    const before = await editCount();
    await edit.applyPatch(txnId, { description: 'Groceries for the week' });
    expect(await editCount()).toBe(before);
  });
});

describe('I4 — a manual category change sets the lock via the trigger', () => {
  it('locks the row against future machine passes', async () => {
    const restaurants = await categoryByName(sql, 'Restaurants');
    const updated = await edit.applyPatch(txnId, { category_id: restaurants });

    expect(updated.category_id).toBe(restaurants);
    expect(updated.category_source).toBe('manual');
    expect(updated.category_locked).toBe(true);   // set by the DB, not by us

    const { runCategorization } = await import('@/categorize/run');
    await runCategorization(sql, { noLlm: true });

    const [after] = await sql<{ category_id: string }[]>`
      SELECT category_id FROM transactions WHERE id = ${txnId}`;
    expect(after.category_id).toBe(restaurants);
  });
});

describe('undo', () => {
  it('nulls the override and logs the revert as another edit', async () => {
    const before = await editCount();
    const reverted = await edit.revertField(txnId, 'amount_cents_override');

    expect(reverted.amount_cents_override).toBeNull();
    expect(reverted.eff_amount_cents).toBe(-8712);   // back to the bank's value
    expect(reverted.is_amount_or_date_edited).toBe(false);

    // Append-only: the revert is itself an edit row.
    expect(await editCount()).toBe(before + 1);
    const [last] = await sql<{ field: string; old_value: string; new_value: string | null }[]>`
      SELECT field, old_value, new_value FROM transaction_edits
      WHERE transaction_id = ${txnId} ORDER BY id DESC LIMIT 1`;
    expect(last.field).toBe('amount_cents_override');
    expect(last.old_value).toBe('-5000');
    expect(last.new_value).toBeNull();
  });

  it('refuses to revert a field that is not an override', async () => {
    await expect(edit.revertField(txnId, 'amount_cents')).rejects.toThrow(/cannot be reverted/i);
  });
});

describe('I5 — voiding, not deleting', () => {
  it('keeps the row but removes it from spending', async () => {
    const voided = await edit.applyPatch(txnId, {
      voided_at: new Date().toISOString(),
      void_reason: 'Duplicate import',
    });
    expect(voided.voided_at).not.toBeNull();
    expect(voided.counts_as_spending).toBe(false);

    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM transactions WHERE id = ${txnId}`;
    expect(c).toBe(1);   // still there

    // Un-voiding restores it and clears the reason.
    const restored = await edit.applyPatch(txnId, { voided_at: null });
    expect(restored.voided_at).toBeNull();
    expect(restored.void_reason).toBeNull();
  });
});

describe('validation', () => {
  it('rejects an unknown field', () => {
    const r = edit.TransactionPatchSchema.safeParse({ amount_cents: -100 });
    expect(r.success).toBe(false);
  });

  it('rejects a non-integer amount — cents are integers (I1)', () => {
    const r = edit.TransactionPatchSchema.safeParse({ amount_cents_override: -50.5 });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(edit.TransactionPatchSchema.safeParse({ posted_date_override: '08/09/2026' }).success)
      .toBe(false);
    expect(edit.TransactionPatchSchema.safeParse({ posted_date_override: '2026-08-09' }).success)
      .toBe(true);
  });

  it('accepts an explicit null to clear an override', () => {
    expect(edit.TransactionPatchSchema.safeParse({ category_id: null }).success).toBe(true);
  });
});

describe('getCategoryBreakdownRange returns one row per category', () => {
  it('does not split a category across its cost types', async () => {
    // Calls the exported query rather than re-implementing its SQL: a test that
    // rebuilds the aggregation passes even when the real function is wrong,
    // which defeats the point of having it.
    const entertainment = await categoryByName(sql, 'Entertainment');
    const { upsertTransactions } = await import('@/ingest/upsert');

    await upsertTransactions(sql, [
      { accountId: acct.checkingId, amountCents: -25196, postedDate: '2026-03-10',
        status: 'posted', rawDescription: 'FIXED INSTALMENT', source: 'csv', externalId: null },
      { accountId: acct.checkingId, amountCents: -4200, postedDate: '2026-03-12',
        status: 'posted', rawDescription: 'VARIABLE NIGHT OUT', source: 'csv', externalId: null },
    ]);
    await sql`
      UPDATE transactions SET category_id = ${entertainment}, category_source = 'manual',
        cost_type_override = CASE WHEN raw_description = 'FIXED INSTALMENT'
                                  THEN 'fixed'::cost_type ELSE 'variable'::cost_type END
      WHERE raw_description IN ('FIXED INSTALMENT', 'VARIABLE NIGHT OUT')`;

    // Both cost types are genuinely present on this category...
    const [{ axes }] = await sql<{ axes: number }[]>`
      SELECT count(DISTINCT eff_cost_type)::int AS axes FROM v_transactions
      WHERE category_id = ${entertainment} AND counts_as_spending`;
    expect(axes).toBe(2);

    const rows = await queries.getCategoryBreakdownRange('2026-01-01', '2026-12-31');

    // ...but the breakdown still returns exactly one row for it.
    const forCategory = rows.filter((r) => r.category_id === entertainment);
    expect(forCategory).toHaveLength(1);

    // Carrying the WHOLE amount, not one half of it.
    expect(forCategory[0].total_cents).toBe(25196 + 4200);
    expect(forCategory[0].txn_count).toBe(2);

    // And reporting the cost type that holds more money — the fixed instalment
    // at $251.96 outweighs the variable $42.00.
    expect(forCategory[0].cost_type).toBe('fixed');

    // Keys built from (category_id, necessity) are therefore unique, which is
    // what the duplicate-React-key error was about.
    const keys = rows.map((r) => `${r.category_id}-${r.necessity}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('bulk edits are manual edits', () => {
  it('sets the lock on every row it touches', async () => {
    const { upsertTransactions } = await import('@/ingest/upsert');
    await upsertTransactions(sql, [
      { accountId: acct.appleId, amountCents: -1200, postedDate: '2026-08-01', status: 'posted', rawDescription: 'BULK A', source: 'csv', externalId: null },
      { accountId: acct.appleId, amountCents: -1300, postedDate: '2026-08-02', status: 'posted', rawDescription: 'BULK B', source: 'csv', externalId: null },
    ]);
    const ids = (await sql<{ id: string }[]>`
      SELECT id FROM transactions WHERE raw_description LIKE 'BULK%'`).map((r) => r.id);

    const travel = await categoryByName(sql, 'Travel');
    const n = await edit.bulkSetCategory(ids, travel);
    expect(n).toBe(2);

    const rows = await sql<{ category_locked: boolean; category_source: string }[]>`
      SELECT category_locked, category_source FROM transactions WHERE id = ANY(${ids}::uuid[])`;
    expect(rows.every((r) => r.category_locked && r.category_source === 'manual')).toBe(true);

    // And each got an edit row.
    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM transaction_edits WHERE transaction_id = ANY(${ids}::uuid[])`;
    expect(c).toBe(2);
  });
});

async function monthTotal(): Promise<number> {
  const [row] = await sql<{ required_cents: number | null }[]>`
    SELECT required_cents FROM v_monthly_cashflow WHERE month = '2026-08-01'`;
  return row?.required_cents ?? 0;
}

async function editCount(): Promise<number> {
  const [{ c }] = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM transaction_edits WHERE transaction_id = ${txnId}`;
  return c;
}
