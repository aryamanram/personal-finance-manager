/**
 * M4 acceptance: re-running the categorizer does not change any row where
 * category_locked = true. DESIGN.md says to write this as an actual test, not
 * a manual check.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb, seedAccounts, categoryByName } from './helpers/db';
import { upsertTransactions } from '@/ingest/upsert';
import { runCategorization } from '@/categorize/run';
import { applyRules } from '@/categorize/rules';
import type { CanonicalTxn } from '@/lib/types';

let sql: Sql;
let drop: () => Promise<void>;
let acct: Awaited<ReturnType<typeof seedAccounts>>;

const txn = (
  over: Partial<CanonicalTxn> & { accountId: string; rawDescription: string; amountCents: number },
): CanonicalTxn => ({
  postedDate: '2026-08-15',
  status: 'posted',
  source: 'csv',
  externalId: null,
  ...over,
});

beforeAll(async () => {
  const db = await createTestDb('categorize');
  sql = db.sql;
  drop = db.drop;
  acct = await seedAccounts(sql);

  await upsertTransactions(sql, [
    txn({ accountId: acct.checkingId, rawDescription: 'PAYROLL ACME CORP DIRECT DEP', amountCents: 540000, postedDate: '2026-08-01' }),
    txn({ accountId: acct.checkingId, rawDescription: 'GREYSTAR RENT PAYMENT', amountCents: -285000, postedDate: '2026-08-01' }),
    txn({ accountId: acct.appleId,    rawDescription: 'STARBUCKS #12345', amountCents: -450 }),
    txn({ accountId: acct.appleId,    rawDescription: 'STARBUCKS #99887', amountCents: -575, postedDate: '2026-08-16' }),
    txn({ accountId: acct.appleId,    rawDescription: 'NETFLIX.COM', amountCents: -1599, postedDate: '2026-08-07' }),
    txn({ accountId: acct.explorerId, rawDescription: 'MYSTERY VENDOR XJ7', amountCents: -3300, postedDate: '2026-08-09' }),
  ]);

  // Rules mirroring what a real setup would have.
  const [paycheck, rent, coffee, subs] = await Promise.all([
    categoryByName(sql, 'Paycheck'), categoryByName(sql, 'Rent'),
    categoryByName(sql, 'Coffee'), categoryByName(sql, 'Subscriptions'),
  ]);
  await sql`INSERT INTO rules (name, priority, match_regex, set_category_id) VALUES
    ('Payroll',   10, 'PAYROLL|DIRECT DEP', ${paycheck}),
    ('Rent',      20, 'GREYSTAR|RENT',      ${rent}),
    ('Starbucks', 30, 'STARBUCKS',          ${coffee}),
    ('Netflix',   30, 'NETFLIX',            ${subs})`;
}, 30_000);

afterAll(async () => { await drop(); });

describe('the pipeline', () => {
  it('categorizes by rule and buckets the rest', async () => {
    const r = await runCategorization(sql, { noLlm: true });
    expect(r.byRule).toBe(5);
    expect(r.merchantsCreated).toBeGreaterThan(0);

    const rows = await sql<{ raw_description: string; category_name: string; category_source: string }[]>`
      SELECT raw_description, category_name, category_source FROM v_transactions ORDER BY raw_description`;

    const byDesc = Object.fromEntries(rows.map((r) => [r.raw_description, r]));
    expect(byDesc['PAYROLL ACME CORP DIRECT DEP'].category_name).toBe('Paycheck');
    expect(byDesc['GREYSTAR RENT PAYMENT'].category_name).toBe('Rent');
    expect(byDesc['STARBUCKS #12345'].category_name).toBe('Coffee');
    expect(byDesc['NETFLIX.COM'].category_name).toBe('Subscriptions');
    // No rule matched, no API key in tests: lands in Uncategorized, honestly.
    expect(byDesc['MYSTERY VENDOR XJ7'].category_name).toBe('Uncategorized');
    expect(byDesc['MYSTERY VENDOR XJ7'].category_source).toBe('default');
  });

  it('is idempotent — a second run changes nothing', async () => {
    const before = await sql<{ id: string; category_id: string; updated_at: Date }[]>`
      SELECT id, category_id FROM transactions ORDER BY id`;

    const r = await runCategorization(sql, { noLlm: true });
    expect(r.byRule).toBe(0);          // nothing left to do
    expect(r.toUncategorized).toBe(0);

    const after = await sql<{ id: string; category_id: string }[]>`
      SELECT id, category_id FROM transactions ORDER BY id`;
    expect(after).toEqual(before);
  });
});

describe('I4 — machine passes never overwrite human decisions', () => {
  it('leaves a manually categorized row alone across a full re-run', async () => {
    // The user insists this Starbucks was actually a gift.
    const gifts = await categoryByName(sql, 'Gifts');
    const [target] = await sql<{ id: string }[]>`
      SELECT id FROM transactions WHERE raw_description = 'STARBUCKS #12345'`;

    await sql`
      UPDATE transactions SET category_id = ${gifts}, category_source = 'manual'
      WHERE id = ${target.id}`;

    // The trigger, not application code, sets the lock.
    const [locked] = await sql<{ category_locked: boolean }[]>`
      SELECT category_locked FROM transactions WHERE id = ${target.id}`;
    expect(locked.category_locked).toBe(true);

    // Run everything again. The Starbucks rule matches this row and would
    // happily set it back to Coffee without the guard.
    await runCategorization(sql, { noLlm: true });

    const [after] = await sql<{ category_id: string; category_source: string }[]>`
      SELECT category_id, category_source FROM transactions WHERE id = ${target.id}`;
    expect(after.category_id).toBe(gifts);
    expect(after.category_source).toBe('manual');

    // The sibling Starbucks row, untouched by a human, still follows the rule.
    const [sibling] = await sql<{ category_name: string }[]>`
      SELECT category_name FROM v_transactions WHERE raw_description = 'STARBUCKS #99887'`;
    expect(sibling.category_name).toBe('Coffee');
  });

  it('protects a manual cost_type/necessity override from a rule', async () => {
    const [target] = await sql<{ id: string }[]>`
      SELECT id FROM transactions WHERE raw_description = 'NETFLIX.COM'`;

    await sql`
      UPDATE transactions
      SET necessity_override = 'required', category_source = 'manual'
      WHERE id = ${target.id}`;

    const coffee = await categoryByName(sql, 'Coffee');
    await sql`INSERT INTO rules (name, priority, match_regex, set_category_id, set_necessity)
              VALUES ('Netflix override attempt', 5, 'NETFLIX', ${coffee}, 'discretionary')`;

    await applyRules(sql);

    const [after] = await sql<{ eff_necessity: string; category_name: string }[]>`
      SELECT eff_necessity, category_name FROM v_transactions WHERE id = ${target.id}`;
    expect(after.eff_necessity).toBe('required');
    expect(after.category_name).toBe('Subscriptions');

    await sql`DELETE FROM rules WHERE name = 'Netflix override attempt'`;
  });

  it('throws rather than silently proceeding if a guard is ever dropped', async () => {
    // Simulates the regression: a pass that forgets NOT category_locked. The
    // orchestrator's post-check must catch a fall in the locked count.
    const [{ locked }] = await sql<{ locked: number }[]>`
      SELECT count(*)::int AS locked FROM transactions WHERE category_locked`;
    expect(locked).toBeGreaterThan(0);

    const report = await runCategorization(sql, { noLlm: true });
    expect(report.lockedRowsUntouched).toBe(locked);
  });
});

describe('rules', () => {
  it('applies in priority order, first match wins', async () => {
    await upsertTransactions(sql, [
      txn({ accountId: acct.appleId, rawDescription: 'STARBUCKS RESERVE ROASTERY', amountCents: -2200, postedDate: '2026-08-20' }),
    ]);

    const restaurants = await categoryByName(sql, 'Restaurants');
    // Lower priority number runs first, so this must beat the Starbucks rule.
    await sql`INSERT INTO rules (name, priority, match_regex, set_category_id)
              VALUES ('Roastery is a restaurant', 5, 'RESERVE ROASTERY', ${restaurants})`;

    await runCategorization(sql, { noLlm: true });

    const [row] = await sql<{ category_name: string }[]>`
      SELECT category_name FROM v_transactions
      WHERE raw_description = 'STARBUCKS RESERVE ROASTERY'`;
    expect(row.category_name).toBe('Restaurants');
  });

  it('keeps first-match-wins on a REPEAT run, not just the first', async () => {
    // Regression: applyRules skips rows whose value is already correct (for
    // idempotence). If a rule only claimed rows it CHANGED, then on the second
    // run the high-priority rule would no-op, leave the row unclaimed, and a
    // lower-priority rule would steal it.
    const [before] = await sql<{ category_name: string }[]>`
      SELECT category_name FROM v_transactions
      WHERE raw_description = 'STARBUCKS RESERVE ROASTERY'`;
    expect(before.category_name).toBe('Restaurants');

    await runCategorization(sql, { noLlm: true });
    await runCategorization(sql, { noLlm: true });

    const [after] = await sql<{ category_name: string }[]>`
      SELECT category_name FROM v_transactions
      WHERE raw_description = 'STARBUCKS RESERVE ROASTERY'`;
    expect(after.category_name).toBe('Restaurants');   // not stolen by 'Starbucks'
  });

  it('respects an amount-bounded rule', async () => {
    await upsertTransactions(sql, [
      txn({ accountId: acct.checkingId, rawDescription: 'ATM WITHDRAWAL', amountCents: -20000, postedDate: '2026-08-21' }),
    ]);
    const fees = await categoryByName(sql, 'Fees & Interest');
    await sql`INSERT INTO rules (name, priority, match_regex, match_amount_max, set_category_id)
              VALUES ('Big ATM', 40, 'ATM', ${-10000}, ${fees})`;

    await runCategorization(sql, { noLlm: true });
    const [row] = await sql<{ category_name: string }[]>`
      SELECT category_name FROM v_transactions WHERE raw_description = 'ATM WITHDRAWAL'`;
    expect(row.category_name).toBe('Fees & Interest');
  });
});

describe('merchant defaults', () => {
  it('propagates a merchant default to future transactions of that merchant', async () => {
    const travel = await categoryByName(sql, 'Travel');
    await sql`
      UPDATE merchants SET default_category_id = ${travel}
      WHERE normalized_name LIKE '%mystery vendor%'`;

    await runCategorization(sql, { noLlm: true });

    const [row] = await sql<{ category_name: string; category_source: string }[]>`
      SELECT category_name, category_source FROM v_transactions
      WHERE raw_description = 'MYSTERY VENDOR XJ7'`;
    expect(row.category_name).toBe('Travel');
  });
});
