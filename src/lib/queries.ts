/**
 * Read path. Everything goes through v_transactions and uses eff_* values (I3).
 * No COALESCE resolution happens in TypeScript anywhere in this file.
 */
import 'server-only';
import { sql } from './db';
import type { VTransaction, MonthlyCashflow, CategoryWithGroup, Account } from './types';

export interface TransactionFilters {
  from?: string;
  to?: string;
  accountIds?: string[];
  categoryIds?: string[];
  necessity?: string[];
  costType?: string[];
  search?: string;
  uncategorizedOnly?: boolean;
  includeVoided?: boolean;
  includeTransfers?: boolean;
  limit?: number;
  offset?: number;
}

export async function getTransactions(f: TransactionFilters = {}) {
  const rows = await sql<VTransaction[]>`
    SELECT * FROM v_transactions
    WHERE superseded_by_id IS NULL
      ${f.includeVoided ? sql`` : sql`AND voided_at IS NULL`}
      ${f.includeTransfers === false ? sql`AND transfer_id IS NULL` : sql``}
      ${f.from ? sql`AND eff_posted_date >= ${f.from}::date` : sql``}
      ${f.to ? sql`AND eff_posted_date <= ${f.to}::date` : sql``}
      ${f.accountIds?.length ? sql`AND account_id = ANY(${f.accountIds}::uuid[])` : sql``}
      ${f.categoryIds?.length ? sql`AND category_id = ANY(${f.categoryIds}::uuid[])` : sql``}
      ${f.necessity?.length ? sql`AND eff_necessity::text = ANY(${f.necessity})` : sql``}
      ${f.costType?.length ? sql`AND eff_cost_type::text = ANY(${f.costType})` : sql``}
      ${f.uncategorizedOnly
        ? sql`AND (category_id IS NULL OR category_source IN ('unset','default'))`
        : sql``}
      ${f.search
        ? sql`AND (eff_description ILIKE ${'%' + f.search + '%'}
                   OR raw_description ILIKE ${'%' + f.search + '%'})`
        : sql``}
    ORDER BY eff_posted_date DESC, created_at DESC
    LIMIT ${f.limit ?? 200} OFFSET ${f.offset ?? 0}`;
  return rows;
}

export async function countTransactions(f: TransactionFilters = {}): Promise<number> {
  const [{ c }] = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM v_transactions
    WHERE superseded_by_id IS NULL
      ${f.includeVoided ? sql`` : sql`AND voided_at IS NULL`}
      ${f.from ? sql`AND eff_posted_date >= ${f.from}::date` : sql``}
      ${f.to ? sql`AND eff_posted_date <= ${f.to}::date` : sql``}
      ${f.accountIds?.length ? sql`AND account_id = ANY(${f.accountIds}::uuid[])` : sql``}
      ${f.categoryIds?.length ? sql`AND category_id = ANY(${f.categoryIds}::uuid[])` : sql``}
      ${f.uncategorizedOnly
        ? sql`AND (category_id IS NULL OR category_source IN ('unset','default'))`
        : sql``}
      ${f.search
        ? sql`AND (eff_description ILIKE ${'%' + f.search + '%'}
                   OR raw_description ILIKE ${'%' + f.search + '%'})`
        : sql``}`;
  return c;
}

export async function getTransaction(id: string): Promise<VTransaction | null> {
  const [row] = await sql<VTransaction[]>`SELECT * FROM v_transactions WHERE id = ${id}`;
  return row ?? null;
}

export async function getCashflow(months = 12): Promise<MonthlyCashflow[]> {
  const rows = await sql<MonthlyCashflow[]>`
    SELECT * FROM v_monthly_cashflow ORDER BY month DESC LIMIT ${months}`;
  return rows.reverse();  // chronological for charting
}

export interface CategoryBreakdownRow {
  category_id: string | null;
  category_name: string;
  category_group_name: string;
  necessity: string;
  cost_type: string;
  total_cents: number;
  txn_count: number;
}

export async function getCategoryBreakdown(month: string): Promise<CategoryBreakdownRow[]> {
  return sql<CategoryBreakdownRow[]>`
    SELECT
      category_id,
      COALESCE(category_name, 'Uncategorized')     AS category_name,
      COALESCE(category_group_name, 'Other')       AS category_group_name,
      eff_necessity::text                          AS necessity,
      eff_cost_type::text                          AS cost_type,
      -SUM(eff_amount_cents)::bigint               AS total_cents,
      count(*)::int                                AS txn_count
    FROM v_transactions
    WHERE counts_as_spending
      AND date_trunc('month', eff_posted_date) = ${month}::date
    GROUP BY 1,2,3,4,5
    HAVING -SUM(eff_amount_cents) > 0
    ORDER BY total_cents DESC`;
}

/**
 * The four cashflow totals over an arbitrary range, rather than one calendar
 * month. v_monthly_cashflow answers per-month; this answers per-period, using
 * the same predicates so the two can never disagree.
 */
export interface PeriodTotals {
  income_cents: number;
  required_cents: number;
  discretionary_cents: number;
  invested_cents: number;
  fixed_cents: number;
  variable_cents: number;
}

/** Returns cashflow totals for an inclusive ledger date range. */
export async function getPeriodTotals(from: string, to: string): Promise<PeriodTotals> {
  const [row] = await sql<PeriodTotals[]>`
    SELECT
      COALESCE(SUM(eff_amount_cents) FILTER (
        WHERE eff_necessity = 'income' AND voided_at IS NULL
          AND superseded_by_id IS NULL), 0)::bigint          AS income_cents,
      COALESCE(-SUM(eff_amount_cents) FILTER (
        WHERE counts_as_spending AND eff_necessity = 'required'), 0)::bigint
                                                             AS required_cents,
      COALESCE(-SUM(eff_amount_cents) FILTER (
        WHERE counts_as_spending AND eff_necessity = 'discretionary'), 0)::bigint
                                                             AS discretionary_cents,
      COALESCE(-SUM(eff_amount_cents) FILTER (
        WHERE eff_necessity = 'investment' AND voided_at IS NULL
          AND superseded_by_id IS NULL), 0)::bigint          AS invested_cents,
      COALESCE(-SUM(eff_amount_cents) FILTER (
        WHERE counts_as_spending AND eff_cost_type = 'fixed'), 0)::bigint
                                                             AS fixed_cents,
      COALESCE(-SUM(eff_amount_cents) FILTER (
        WHERE counts_as_spending AND eff_cost_type = 'variable'), 0)::bigint
                                                             AS variable_cents
    FROM v_transactions
    WHERE eff_posted_date >= ${from}::date AND eff_posted_date <= ${to}::date`;
  return row;
}

/** Category breakdown over an arbitrary range. */
export async function getCategoryBreakdownRange(
  from: string,
  to: string,
): Promise<CategoryBreakdownRow[]> {
  return sql<CategoryBreakdownRow[]>`
    SELECT
      category_id,
      COALESCE(category_name, 'Uncategorized')     AS category_name,
      COALESCE(category_group_name, 'Other')       AS category_group_name,
      eff_necessity::text                          AS necessity,
      eff_cost_type::text                          AS cost_type,
      -SUM(eff_amount_cents)::bigint               AS total_cents,
      count(*)::int                                AS txn_count
    FROM v_transactions
    WHERE counts_as_spending
      AND eff_posted_date >= ${from}::date AND eff_posted_date <= ${to}::date
    GROUP BY 1,2,3,4,5
    HAVING -SUM(eff_amount_cents) > 0
    ORDER BY total_cents DESC`;
}

/** Earliest and latest transaction, for bounding the period picker. */
export async function getLedgerBounds(): Promise<{ first: string; last: string } | null> {
  const [row] = await sql<{ first: string; last: string }[]>`
    SELECT MIN(eff_posted_date) AS first, MAX(eff_posted_date) AS last
    FROM v_transactions WHERE voided_at IS NULL AND superseded_by_id IS NULL`;
  return row?.first ? row : null;
}

export async function getCategories(): Promise<CategoryWithGroup[]> {
  return sql<CategoryWithGroup[]>`
    SELECT c.*, g.name AS group_name, g.sort_order AS group_sort_order
    FROM categories c JOIN category_groups g ON g.id = c.group_id
    WHERE NOT c.is_archived
    ORDER BY g.sort_order, c.sort_order, c.name`;
}

export async function getAccounts(): Promise<Account[]> {
  return sql<Account[]>`SELECT * FROM accounts WHERE is_active ORDER BY type, name`;
}

export async function getUncategorizedCount(): Promise<number> {
  const [{ c }] = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM v_transactions
    WHERE superseded_by_id IS NULL AND voided_at IS NULL
      AND (category_id IS NULL OR category_source IN ('unset','default'))`;
  return c;
}

export interface NetWorthRow {
  account_id: string;
  name: string;
  type: string;
  balance_cents: number;
  basis: string;
  snapshot_date: string | null;
}

export async function getNetWorth(): Promise<NetWorthRow[]> {
  return sql<NetWorthRow[]>`SELECT * FROM v_net_worth ORDER BY type, name`;
}

export interface InvestmentPerformance {
  account_id: string;
  name: string;
  opening_date: string;
  opening_cents: number;
  as_of: string;
  current_cents: number;
  contributed_cents: number;
  gain_cents: number;
  return_pct: number | null;
}

export async function getInvestmentPerformance(accountId?: string) {
  return sql<InvestmentPerformance[]>`
    SELECT * FROM v_investment_performance
    ${accountId ? sql`WHERE account_id = ${accountId}` : sql``}`;
}

export async function getEditHistory(transactionId: string) {
  return sql<{ id: number; field: string; old_value: string | null; new_value: string | null; edited_at: Date }[]>`
    SELECT id, field, old_value, new_value, edited_at
    FROM transaction_edits WHERE transaction_id = ${transactionId}
    ORDER BY edited_at DESC, id DESC`;
}

/** Latest sync per source, for the dashboard's staleness banner. */
export async function getLastSync() {
  const [row] = await sql<{ status: string; finished_at: Date | null; error: string | null; txns_inserted: number }[]>`
    SELECT status, finished_at, error, txns_inserted FROM sync_runs
    ORDER BY started_at DESC LIMIT 1`;
  return row ?? null;
}

/**
 * DESIGN.md §12: when the sum of an account's transactions diverges from the
 * balance the bank reported, surface it passively rather than blocking.
 * Reads raw amount_cents deliberately — reconciliation is one of the two places
 * allowed to (I3).
 */
export async function getReconciliation() {
  return sql<{ name: string; ledger_cents: number; reported_cents: number; drift_cents: number }[]>`
    SELECT a.name,
           COALESCE(SUM(t.amount_cents), 0)::bigint        AS ledger_cents,
           a.balance_cents                                 AS reported_cents,
           (a.balance_cents - COALESCE(SUM(t.amount_cents), 0))::bigint AS drift_cents
    FROM accounts a
    LEFT JOIN transactions t
      ON t.account_id = a.id AND t.voided_at IS NULL AND t.superseded_by_id IS NULL
    WHERE a.is_active AND a.balance_cents IS NOT NULL AND a.type <> 'investment'
    GROUP BY a.id, a.name, a.balance_cents
    HAVING a.balance_cents <> COALESCE(SUM(t.amount_cents), 0)`;
}
