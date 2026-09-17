/**
 * DESIGN.md §13. The brokerage is modelled on a different axis from spending,
 * and conflating the two is the main risk in the whole design.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb, seedAccounts, categoryByName } from './helpers/db';
import { upsertTransactions } from '@/ingest/upsert';

let sql: Sql;
let drop: () => Promise<void>;
let acct: Awaited<ReturnType<typeof seedAccounts>>;

beforeAll(async () => {
  const db = await createTestDb('investment');
  sql = db.sql;
  drop = db.drop;
  acct = await seedAccounts(sql);

  // The worked example from DESIGN.md §13:
  //   opening $80,000, contributed $4,000, worth $87,200 -> gain $3,200, 3.90%
  await sql`
    INSERT INTO balance_snapshots (account_id, as_of, balance_cents) VALUES
      (${acct.brokerageId}, '2026-01-01', 8000000),
      (${acct.brokerageId}, '2026-07-01', 8720000)`;

  const contribution = await categoryByName(sql, 'Brokerage Contribution');
  await upsertTransactions(sql, [
    { accountId: acct.checkingId, amountCents: -200000, postedDate: '2026-02-01',
      status: 'posted', rawDescription: 'MORGAN STANLEY ACH', source: 'simplefin', externalId: 'c1' },
    { accountId: acct.checkingId, amountCents: -200000, postedDate: '2026-04-01',
      status: 'posted', rawDescription: 'MORGAN STANLEY ACH', source: 'simplefin', externalId: 'c2' },
  ]);
  await sql`
    UPDATE transactions
    SET destination_account_id = ${acct.brokerageId}, category_id = ${contribution},
        category_source = 'rule'
    WHERE raw_description = 'MORGAN STANLEY ACH'`;
}, 30_000);

afterAll(async () => { await drop(); });

describe('the opening balance is not a gain', () => {
  it('measures growth from the first snapshot, never from zero', async () => {
    const [p] = await sql<{
      opening_cents: number; current_cents: number;
      contributed_cents: number; gain_cents: number; return_pct: number;
    }[]>`SELECT * FROM v_investment_performance WHERE account_id = ${acct.brokerageId}`;

    expect(p.opening_cents).toBe(8000000);
    expect(p.current_cents).toBe(8720000);
    expect(p.contributed_cents).toBe(400000);
    // $87,200 - $80,000 - $4,000 = $3,200. Not $87,200.
    expect(p.gain_cents).toBe(320000);
  });

  it('holds the identity opening + contributed + gain = current', async () => {
    const [{ holds }] = await sql<{ holds: boolean }[]>`
      SELECT (opening_cents + contributed_cents + gain_cents = current_cents) AS holds
      FROM v_investment_performance WHERE account_id = ${acct.brokerageId}`;
    // If this drifts, a contribution lost its destination_account_id.
    expect(holds).toBe(true);
  });

  it('reports Modified Dietz, not the naive return that counts deposits as gains', async () => {
    const [p] = await sql<{ return_pct: number }[]>`
      SELECT return_pct FROM v_investment_performance WHERE account_id = ${acct.brokerageId}`;

    const naive = ((8720000 - 8000000) / 8000000) * 100;   // 9.00% — wrong
    expect(naive).toBeCloseTo(9.0, 1);
    expect(Number(p.return_pct)).toBeLessThan(naive);
    expect(Number(p.return_pct)).toBeCloseTo(3.9, 0);
  });
});

describe('period totals agree with the monthly view', () => {
  it('matches v_monthly_cashflow for the same single month', async () => {
    // The dashboard reads getPeriodTotals for an arbitrary range while the bar
    // chart reads v_monthly_cashflow. If the two ever disagree, the same page
    // shows two different numbers for the same month.
    const [monthly] = await sql<{
      income_cents: number | null; required_cents: number | null;
      discretionary_cents: number | null; invested_cents: number | null;
    }[]>`SELECT * FROM v_monthly_cashflow WHERE month = '2026-02-01'`;

    const [period] = await sql<{
      income_cents: number; required_cents: number;
      discretionary_cents: number; invested_cents: number;
    }[]>`
      SELECT
        COALESCE(SUM(eff_amount_cents) FILTER (
          WHERE eff_necessity = 'income' AND voided_at IS NULL
            AND superseded_by_id IS NULL), 0)::bigint AS income_cents,
        COALESCE(-SUM(eff_amount_cents) FILTER (
          WHERE counts_as_spending AND eff_necessity = 'required'), 0)::bigint AS required_cents,
        COALESCE(-SUM(eff_amount_cents) FILTER (
          WHERE counts_as_spending AND eff_necessity = 'discretionary'), 0)::bigint AS discretionary_cents,
        COALESCE(-SUM(eff_amount_cents) FILTER (
          WHERE eff_necessity = 'investment' AND voided_at IS NULL
            AND superseded_by_id IS NULL), 0)::bigint AS invested_cents
      FROM v_transactions
      WHERE eff_posted_date >= '2026-02-01'::date AND eff_posted_date <= '2026-02-28'::date`;

    expect(period.invested_cents).toBe(monthly?.invested_cents ?? 0);
    expect(period.income_cents).toBe(monthly?.income_cents ?? 0);
    expect(period.required_cents).toBe(monthly?.required_cents ?? 0);
  });
});

describe('market movement never reaches the cashflow view', () => {
  it('keeps a 9% month out of income', async () => {
    const rows = await sql<{ income_cents: number | null }[]>`
      SELECT income_cents FROM v_monthly_cashflow`;
    // No income anywhere: the only transactions are outbound contributions.
    expect(rows.every((r) => r.income_cents === null || r.income_cents === 0)).toBe(true);
  });

  it('counts the contribution as invested, not as spending', async () => {
    const [row] = await sql<{ invested_cents: number; discretionary_cents: number | null }[]>`
      SELECT invested_cents, discretionary_cents FROM v_monthly_cashflow
      WHERE month = '2026-02-01'`;
    expect(row.invested_cents).toBe(200000);
    expect(row.discretionary_cents).toBeNull();

    const [t] = await sql<{ counts_as_spending: boolean }[]>`
      SELECT counts_as_spending FROM v_transactions WHERE external_id = 'c1'`;
    expect(t.counts_as_spending).toBe(false);
  });

  it('reports the brokerage in net worth from its snapshot, not its ledger', async () => {
    const [nw] = await sql<{ balance_cents: number; basis: string }[]>`
      SELECT balance_cents, basis FROM v_net_worth WHERE account_id = ${acct.brokerageId}`;
    expect(nw.basis).toBe('snapshot');
    expect(nw.balance_cents).toBe(8720000);
  });
});
