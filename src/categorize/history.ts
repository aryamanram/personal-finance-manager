/**
 * Reads the guesser's inputs from the database: every human decision, and the
 * live category list. Through v_transactions and eff_* (I3).
 */
import type { Sql } from 'postgres';
import type { AccountType } from '@/lib/types';
import { buildModel, type Decision, type GuessModel } from './guess';

export interface DecidedRow extends Decision {
  id: string;
}

/**
 * Rows a human has decided: locked, filed somewhere real. Uncategorized is
 * excluded even when locked — "nobody knows" is not an answer worth learning.
 */
export async function loadDecisions(sql: Sql): Promise<DecidedRow[]> {
  const rows = await sql<{
    id: string; raw_description: string; eff_amount_cents: number;
    account_type: AccountType; category_id: string; eff_posted_date: string;
  }[]>`
    SELECT t.id, t.raw_description, t.eff_amount_cents, t.account_type,
           t.category_id, t.eff_posted_date::text AS eff_posted_date
    FROM v_transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.category_locked
      AND t.superseded_by_id IS NULL
      AND t.voided_at IS NULL
      AND c.name <> 'Uncategorized'
    ORDER BY t.eff_posted_date, t.created_at`;
  return rows.map((r) => ({
    id: r.id,
    rawDescription: r.raw_description,
    amountCents: Number(r.eff_amount_cents),
    accountType: r.account_type,
    categoryId: r.category_id,
    postedDate: r.eff_posted_date,
  }));
}

/** Categories a guess may land on: live, and not the fallback bucket. */
export async function loadGuessableCategories(
  sql: Sql,
): Promise<{ id: string; name: string; parent_id: string | null }[]> {
  return sql<{ id: string; name: string; parent_id: string | null }[]>`
    SELECT id, name, parent_id FROM categories WHERE NOT is_archived AND name <> 'Uncategorized'`;
}

export async function loadModel(sql: Sql): Promise<GuessModel> {
  const [decisions, categories] = await Promise.all([loadDecisions(sql), loadGuessableCategories(sql)]);
  return buildModel(decisions, categories);
}
