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
  /** Only rows a machine categorised that no human has confirmed. */
  needsReviewOnly?: boolean;
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
      ${f.needsReviewOnly
        ? sql`AND NOT category_locked AND category_id IS NOT NULL
              AND category_source IN ('rule','llm','import')`
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
      ${f.needsReviewOnly
        ? sql`AND NOT category_locked AND category_id IS NOT NULL
              AND category_source IN ('rule','llm','import')`
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
/**
 * One row per (category, necessity) — deliberately NOT per cost_type.
 *
 * Grouping by cost_type as well splits a category whose transactions are mixed:
 * Entertainment arrives as its fixed half (instalment plans) and its variable
 * half. Both consumers then have to fold it back, and the one that forgets
 * renders the same category twice under the same React key.
 *
 * cost_type is still reported, as whichever side holds more money, because the
 * list shows it as a hint. The fixed/variable split proper belongs to the bar
 * chart, which reads v_monthly_cashflow.
 */
export async function getCategoryBreakdownRange(
  from: string,
  to: string,
): Promise<CategoryBreakdownRow[]> {
  return sql<CategoryBreakdownRow[]>`
    WITH per_axis AS (
      SELECT
        category_id,
        COALESCE(category_name, 'Uncategorized')   AS category_name,
        COALESCE(category_group_name, 'Other')     AS category_group_name,
        eff_necessity::text                        AS necessity,
        eff_cost_type::text                        AS cost_type,
        -SUM(eff_amount_cents)::bigint             AS total_cents,
        count(*)::int                              AS txn_count
      FROM v_transactions
      WHERE counts_as_spending
        AND eff_posted_date >= ${from}::date AND eff_posted_date <= ${to}::date
      GROUP BY 1,2,3,4,5
    )
    SELECT
      category_id,
      category_name,
      category_group_name,
      necessity,
      -- The cost type carrying the larger share of the money.
      (ARRAY_AGG(cost_type ORDER BY total_cents DESC))[1] AS cost_type,
      SUM(total_cents)::bigint                            AS total_cents,
      SUM(txn_count)::int                                 AS txn_count
    FROM per_axis
    GROUP BY 1,2,3,4
    HAVING SUM(total_cents) > 0
    ORDER BY total_cents DESC`;
}

/**
 * Every month the ledger has activity in, oldest first. Deliberately separate
 * from getCashflow(n): the chart wants a bounded window, the period picker
 * wants the whole history, and sharing one query hid any year older than that
 * window from the picker.
 */
export async function getActiveMonths(): Promise<string[]> {
  const rows = await sql<{ month: string }[]>`
    SELECT DISTINCT date_trunc('month', eff_posted_date)::date AS month
    FROM v_transactions
    WHERE voided_at IS NULL AND superseded_by_id IS NULL
    ORDER BY month DESC`;
  return rows.map((r) => r.month);
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
    SELECT c.*, g.name AS group_name, g.sort_order AS group_sort_order,
           p.name AS parent_name
    FROM categories c
    JOIN category_groups g ON g.id = c.group_id
    LEFT JOIN categories p ON p.id = c.parent_id
    WHERE NOT c.is_archived
    -- Parents before their own children, so a consumer that walks this list
    -- in order meets a parent before anything that rolls up into it.
    ORDER BY g.sort_order, COALESCE(p.sort_order, c.sort_order), c.parent_id NULLS FIRST,
             c.sort_order, c.name`;
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

/**
 * The two review backlogs the register filters on.
 *
 * Deliberately different questions, and conflating them made the old single
 * "uncategorized" count hard to act on:
 *
 *   needs_review  — a machine (rule or LLM) chose it and no human has
 *                   confirmed. There IS a category; it may just be wrong.
 *   uncategorized — nobody and nothing has chosen.
 *
 * A locked row is in neither: locking records a human decision (I4), so a
 * confirmed row cannot also be awaiting confirmation.
 */
export interface ReviewCounts {
  needs_review: number;
  uncategorized: number;
}

/**
 * The two review backlogs, optionally within a date range.
 *
 * The register scopes these to the period it is showing. A chip reading
 * "Needs review · 338" above a filtered table promises 338 rows and then
 * delivers whatever falls inside the period — so the count has to answer the
 * same question the table does, or clicking it looks broken.
 */
export async function getReviewCounts(
  range?: { from?: string; to?: string },
): Promise<ReviewCounts> {
  const [row] = await sql<ReviewCounts[]>`
    SELECT
      count(*) FILTER (
        WHERE NOT category_locked
          AND category_id IS NOT NULL
          AND category_source IN ('rule','llm','import')
      )::int AS needs_review,
      count(*) FILTER (
        WHERE category_id IS NULL OR category_source IN ('unset','default')
      )::int AS uncategorized
    FROM v_transactions
    WHERE superseded_by_id IS NULL AND voided_at IS NULL
      ${range?.from ? sql`AND eff_posted_date >= ${range.from}::date` : sql``}
      ${range?.to ? sql`AND eff_posted_date <= ${range.to}::date` : sql``}`;
  return row;
}

/**
 * How often you have *chosen* each category by hand, most-used first.
 *
 * Counts only locked rows — machine assignments are what the ranking exists to
 * correct, so letting them vote would rank the model's habits rather than
 * yours. This turns a 35-item alphabetical list into the few categories
 * actually in play (wireframe 34:2).
 */
export async function getCategoryUsage(): Promise<Map<string, number>> {
  const rows = await sql<{ category_id: string; uses: number }[]>`
    SELECT category_id, count(*)::int AS uses
    FROM v_transactions
    WHERE superseded_by_id IS NULL AND voided_at IS NULL
      AND category_locked AND category_id IS NOT NULL
    GROUP BY category_id`;
  return new Map(rows.map((r) => [r.category_id, r.uses]));
}

/**
 * What the register knows about one row's merchant, for the edit panel.
 *
 * Deliberately not added to v_transactions: the view is the read path for
 * every page, and this is needed only when a single row is expanded.
 *
 * `siblings` counts the OTHER rows from this merchant that no human has
 * categorised — the "apply to the N other rows" offer. Locked rows are
 * excluded (I4).
 */
export interface MerchantContext {
  merchant_id: string;
  merchant_name: string;
  default_category_id: string | null;
  default_uses: number;
  siblings: number;
}

export async function getMerchantContext(
  transactionId: string,
): Promise<MerchantContext | null> {
  const [row] = await sql<MerchantContext[]>`
    WITH target AS (
      SELECT merchant_id FROM transactions WHERE id = ${transactionId}
    )
    SELECT
      m.id           AS merchant_id,
      m.display_name AS merchant_name,
      m.default_category_id,
      (SELECT count(*)::int FROM v_transactions v
        WHERE v.merchant_id = m.id
          AND v.category_locked
          AND v.category_id IS NOT DISTINCT FROM m.default_category_id
          AND v.voided_at IS NULL AND v.superseded_by_id IS NULL
      )              AS default_uses,
      (SELECT count(*)::int FROM v_transactions v
        WHERE v.merchant_id = m.id
          AND v.id <> ${transactionId}
          AND NOT v.category_locked
          AND v.voided_at IS NULL AND v.superseded_by_id IS NULL
      )              AS siblings
    FROM target t
    JOIN merchants m ON m.id = t.merchant_id`;
  return row ?? null;
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
/**
 * Accounts whose ledger sum does not match the balance the bank reports.
 *
 * Reconciled against BOTH bases, and only reported when neither matches.
 * Institutions disagree about whether a reported balance includes pending
 * authorisations: this ledger's checking balance does, and its cards' do not.
 * Testing one basis therefore invents drift on every account that uses the
 * other — a card with a large pending payment looked thousands of dollars out
 * when it was reconciling exactly.
 *
 * Real drift means a transaction the ledger has not seen, which is what this
 * banner is for. A timing difference in pending rows is not that.
 */
export async function getReconciliation() {
  return sql<{ name: string; ledger_cents: number; reported_cents: number; drift_cents: number }[]>`
    WITH sums AS (
      SELECT a.id, a.name, a.balance_cents,
             COALESCE(SUM(t.amount_cents), 0)::bigint AS all_rows,
             COALESCE(SUM(t.amount_cents) FILTER (WHERE t.status = 'posted'), 0)::bigint
               AS posted_only
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id AND t.voided_at IS NULL AND t.superseded_by_id IS NULL
      WHERE a.is_active AND a.balance_cents IS NOT NULL AND a.type <> 'investment'
      GROUP BY a.id, a.name, a.balance_cents
    )
    SELECT name,
           all_rows                          AS ledger_cents,
           balance_cents                     AS reported_cents,
           -- Report the smaller discrepancy: it names how far off the ledger
           -- is under the basis that fits this account best.
           CASE WHEN abs(balance_cents - all_rows) <= abs(balance_cents - posted_only)
                THEN balance_cents - all_rows
                ELSE balance_cents - posted_only END AS drift_cents
    FROM sums
    WHERE balance_cents <> all_rows AND balance_cents <> posted_only`;
}

export interface CardSettlement {
  name: string;
  /** Everything bought on the card, as positive cents. */
  purchases_cents: number;
  /** Payments the issuer has applied, as positive cents. */
  paid_cents: number;
  /** Payments sent but not yet applied — in flight, not missing. */
  clearing_cents: number;
  /** purchases − paid: what the ledger says is still on the card. */
  owed_cents: number;
  /** What the issuer says is still on the card. */
  bank_owed_cents: number;
  /** bank − ledger, after pending payments are set aside. Zero means it holds. */
  gap_cents: number;
}

/**
 * Proof that a credit card's purchases are a complete, non-duplicated record
 * of spending.
 *
 * A card is a pass-through: money is spent at a merchant, and later the same
 * money leaves checking to settle the balance. Only one of those two is
 * spending. This ledger counts the purchase (that is where the money actually
 * went) and marks the payment `transfer`, so `counts_as_spending` is false on
 * it and nothing is double-counted.
 *
 * That choice is only safe while the card is actually being paid off. If a
 * balance were being carried, purchases would overstate what left the bank.
 * The identity that rules this out is:
 *
 *     purchases − paid_off = still_owed = what the issuer reports
 *
 * When it holds, every dollar charged is accounted for as either settled or
 * currently outstanding — no unrecorded interest, no missing payment, no
 * purchase the feed never delivered. The payments need no category; they exist
 * as evidence of exactly this, and the purchases carry the detail.
 *
 * Only POSTED payments count toward `paid`. A payment the issuer has received
 * but not yet applied is still in the ledger and still reduces what will be
 * owed, but the reported balance does not know about it yet — counting it
 * would make a card look overpaid by the amount currently in flight, which is
 * exactly how a card here read before the split: purchases and payments were
 * equal, so the ledger claimed a zero balance while the issuer still wanted
 * the whole outstanding amount. Pending payments are reported separately as `clearing_cents`.
 *
 * Balances are stored negative on a credit account (money owed), so they are
 * negated here to read as a positive amount outstanding.
 */
export async function getCardSettlement(): Promise<CardSettlement[]> {
  return sql<CardSettlement[]>`
    WITH per_card AS (
      SELECT
        a.name,
        a.balance_cents,
        COALESCE(-SUM(v.eff_amount_cents) FILTER (
          WHERE v.counts_as_spending), 0)::bigint            AS purchases,
        COALESCE(SUM(v.eff_amount_cents) FILTER (
          WHERE v.eff_necessity = 'transfer' AND v.eff_amount_cents > 0
            AND v.status = 'posted'), 0)::bigint             AS paid,
        COALESCE(SUM(v.eff_amount_cents) FILTER (
          WHERE v.eff_necessity = 'transfer' AND v.eff_amount_cents > 0
            AND v.status <> 'posted'), 0)::bigint            AS clearing
      FROM accounts a
      LEFT JOIN v_transactions v
        ON v.account_id = a.id AND v.voided_at IS NULL AND v.superseded_by_id IS NULL
      WHERE a.is_active AND a.type = 'credit' AND a.balance_cents IS NOT NULL
      GROUP BY a.id, a.name, a.balance_cents
    )
    SELECT
      name,
      purchases                        AS purchases_cents,
      paid                             AS paid_cents,
      clearing                         AS clearing_cents,
      (purchases - paid)               AS owed_cents,
      (-balance_cents)                 AS bank_owed_cents,
      (-balance_cents - (purchases - paid)) AS gap_cents
    FROM per_card
    ORDER BY name`;
}

