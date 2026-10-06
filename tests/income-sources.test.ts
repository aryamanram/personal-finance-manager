/**
 * Income sources: "money from this payer is always X". The payer names and
 * originator IDs here are invented.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb, seedAccounts, categoryByName } from './helpers/db';
import { upsertTransactions } from '@/ingest/upsert';
import { runCategorization } from '@/categorize/run';
import { matchIncomeSource, type IncomeSource } from '@/categorize/income-sources';
import { parseAchPayer } from '@/categorize/payer';
import type { CanonicalTxn } from '@/lib/types';

const CSV_FORM = 'ACME CORP        PAYROLL          PPD ID: 9990001111';
const FEED_FORM = 'ORIG CO NAME:ACME CORP CO ENTRY DESCR:PAYROLL SEC:PPD ORIG ID:9990001111';
const SINGLE_SPACED = 'ACME CORP PAYROLL PPD ID: 9990001111';

describe('reading the payer', () => {
  it('reads the same originator from both formats a bank uses', () => {
    expect(parseAchPayer(CSV_FORM)).toEqual({ company: 'ACME CORP', originatorId: '9990001111' });
    expect(parseAchPayer(FEED_FORM)).toEqual({ company: 'ACME CORP', originatorId: '9990001111' });
    // Without padding the entry description cannot be split off; the ID still reads.
    expect(parseAchPayer(SINGLE_SPACED)).toEqual({ company: 'ACME CORP PAYROLL', originatorId: '9990001111' });
  });

  it('returns null for something that is not an ACH credit', () => {
    expect(parseAchPayer('STARBUCKS #1234')).toBeNull();
  });
});

describe('matching', () => {
  const byName: IncomeSource = { id: 'a', name: 'Acme', match_payer: 'acme corp', match_originator_id: null, category_id: 'pay' };
  const byId: IncomeSource = { id: 'b', name: 'Acme', match_payer: null, match_originator_id: '9990001111', category_id: 'pay' };

  it('matches by name across padded and single-spaced forms, ignoring case', () => {
    for (const raw of [CSV_FORM, FEED_FORM, SINGLE_SPACED]) {
      expect(matchIncomeSource(raw, 250000, [byName])?.id).toBe('a');
    }
  });

  it('matches by originator ID even when the name is spelled differently', () => {
    const renamed = 'ORIG CO NAME:ACME CORPORATION LLC CO ENTRY DESCR:SALARY SEC:PPD ORIG ID:9990001111';
    expect(matchIncomeSource(renamed, 250000, [byId])?.id).toBe('b');
    expect(matchIncomeSource(renamed.replace('9990001111', '9990001112'), 250000, [byId])).toBeNull();
  });

  it('never matches money going out', () => {
    expect(matchIncomeSource(CSV_FORM, -250000, [byName, byId])).toBeNull();
    expect(matchIncomeSource(CSV_FORM, 0, [byName, byId])).toBeNull();
  });
});

describe('in the pipeline', () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let acct: Awaited<ReturnType<typeof seedAccounts>>;
  let paycheck: string;

  const txn = (raw: string, amountCents: number, postedDate: string): CanonicalTxn => ({
    accountId: acct.checkingId, rawDescription: raw, amountCents, postedDate,
    status: 'posted', source: 'simplefin', externalId: `x-${postedDate}-${amountCents}`,
  });

  beforeAll(async () => {
    const db = await createTestDb('income_sources');
    sql = db.sql;
    drop = db.drop;
    acct = await seedAccounts(sql);
    paycheck = await categoryByName(sql, 'Paycheck');
    await sql`INSERT INTO income_sources (name, match_payer, category_id)
              VALUES ('Acme', 'ACME CORP', ${paycheck})`;
    await upsertTransactions(sql, [
      txn(FEED_FORM, 312345, '2026-10-15'),
      txn(CSV_FORM, 312345, '2026-10-31'),
      // A payment TO the same company must not become income.
      txn('ACME CORP REFUND OF ADVANCE', -5000, '2026-10-20'),
    ]);
  }, 30_000);

  afterAll(async () => { await drop(); });

  it('files every deposit from the payer as known, and nothing else', async () => {
    const r = await runCategorization(sql);
    expect(r.byIncomeSource).toBe(2);

    const rows = await sql<{ eff_amount_cents: number; category_name: string; category_source: string; suggested_reason: string | null }[]>`
      SELECT eff_amount_cents, category_name, category_source, suggested_reason
      FROM v_transactions ORDER BY eff_posted_date`;
    expect(rows.filter((x) => x.category_source === 'income_source')).toHaveLength(2);
    for (const x of rows.filter((y) => y.eff_amount_cents > 0)) {
      expect(x).toMatchObject({ category_name: 'Paycheck', category_source: 'income_source', suggested_reason: 'income source: Acme' });
    }
    const outflow = rows.find((x) => x.eff_amount_cents < 0)!;
    expect(outflow.category_source).not.toBe('income_source');
  });

  it('is idempotent', async () => {
    const r = await runCategorization(sql);
    expect(r.byIncomeSource).toBe(0);
  });

  it('keeps known income out of the review queue', async () => {
    // Mirrors the predicate getReviewCounts uses.
    const { GUESS_SOURCES } = await import('@/lib/types');
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM v_transactions
      WHERE NOT category_locked AND category_source = ANY(${GUESS_SOURCES as string[]}::category_source[])
        AND eff_amount_cents > 0`;
    expect(n).toBe(0);
  });

  it('returns its rows to guessing when the source is retired', async () => {
    await sql`UPDATE income_sources SET is_active = FALSE`;
    await runCategorization(sql);
    const rows = await sql<{ category_source: string; category_name: string }[]>`
      SELECT category_source, category_name FROM v_transactions
      WHERE eff_amount_cents > 0 ORDER BY eff_posted_date`;
    // The payroll pattern still recognises them — but now as guesses to confirm.
    expect(rows).toEqual([
      { category_source: 'rule', category_name: 'Paycheck' },
      { category_source: 'rule', category_name: 'Paycheck' },
    ]);
    await sql`UPDATE income_sources SET is_active = TRUE`;
  });

  it('never overrides a deposit filed by hand (I4)', async () => {
    const reimb = await categoryByName(sql, 'Reimbursement');
    await sql`UPDATE transactions SET category_id = ${reimb}, category_source = 'manual'
              WHERE posted_date = '2026-10-31'`;
    const r = await runCategorization(sql);
    const rows = await sql<{ category_name: string; category_source: string }[]>`
      SELECT category_name, category_source FROM v_transactions
      WHERE eff_amount_cents > 0 ORDER BY eff_posted_date`;
    expect(rows).toEqual([
      { category_name: 'Paycheck', category_source: 'income_source' },
      { category_name: 'Reimbursement', category_source: 'manual' },
    ]);
    expect(r.byIncomeSource).toBe(1);
  });
});
