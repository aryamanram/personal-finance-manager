/**
 * Writes the guesser's answers (guess.ts) to every unlocked row that no
 * earlier pass claimed. I4: every write carries NOT category_locked.
 *
 * Deterministic and idempotent: the same ledger produces the same guesses, and
 * a row already holding its guess is not rewritten.
 */
import type { Sql } from 'postgres';
import type { AccountType, CategorySource } from '@/lib/types';
import { guess, type GuessModel } from './guess';

/** Sources a pass may withdraw when it no longer has an answer. */
const MACHINE_SOURCES: CategorySource[] = ['rule', 'history', 'income_source'];

export interface GuessPassResult {
  byHistory: number;
  byPattern: number;
  /** Stale machine guesses withdrawn back to "nobody knows". */
  withdrawn: number;
}

export async function applyGuesses(
  sql: Sql,
  model: GuessModel,
  opts: { from?: string; to?: string; exclude?: Set<string> } = {},
): Promise<GuessPassResult> {
  const rows = await sql<{
    id: string; raw_description: string; eff_amount_cents: number; account_type: AccountType;
    category_id: string | null; category_source: CategorySource; suggested_reason: string | null;
  }[]>`
    SELECT id, raw_description, eff_amount_cents, account_type,
           category_id, category_source, suggested_reason
    FROM v_transactions
    WHERE NOT category_locked
      AND superseded_by_id IS NULL
      AND voided_at IS NULL
      ${opts.from ? sql`AND eff_posted_date >= ${opts.from}::date` : sql``}
      ${opts.to ? sql`AND eff_posted_date <= ${opts.to}::date` : sql``}`;

  const ids: string[] = [];
  const categories: string[] = [];
  const sources: string[] = [];
  const confidences: number[] = [];
  const reasons: string[] = [];
  const withdraw: string[] = [];
  let byHistory = 0;
  let byPattern = 0;

  for (const r of rows) {
    if (opts.exclude?.has(r.id)) continue;
    const g = guess(
      { rawDescription: r.raw_description, amountCents: Number(r.eff_amount_cents), accountType: r.account_type },
      model,
    );

    if (!g) {
      // A machine answer nothing supports any more (a rule removed, a source
      // retired) is withdrawn rather than left looking current. An imported
      // category is the source file's own claim and stays.
      if (MACHINE_SOURCES.includes(r.category_source)) withdraw.push(r.id);
      continue;
    }

    const source = g.method === 'history' ? 'history' : 'rule';
    if (r.category_id === g.categoryId && r.category_source === source && r.suggested_reason === g.reason) {
      continue;
    }
    ids.push(r.id);
    categories.push(g.categoryId);
    sources.push(source);
    confidences.push(g.confidence);
    reasons.push(g.reason);
    if (g.method === 'history') byHistory++; else byPattern++;
  }

  if (ids.length > 0) {
    await sql`
      UPDATE transactions t SET
        category_id           = m.category_id,
        category_source       = m.source::category_source,
        suggested_category_id = m.category_id,
        suggested_confidence  = m.confidence,
        suggested_reason      = m.reason
      FROM (
        SELECT unnest(${ids}::uuid[])        AS id,
               unnest(${categories}::uuid[]) AS category_id,
               unnest(${sources}::text[])    AS source,
               unnest(${confidences}::numeric[]) AS confidence,
               unnest(${reasons}::text[])    AS reason
      ) m
      WHERE t.id = m.id AND NOT t.category_locked`;
  }

  if (withdraw.length > 0) {
    // Cleared to NULL; the default pass that follows files them honestly.
    await sql`
      UPDATE transactions SET
        category_id = NULL, category_source = 'unset',
        suggested_category_id = NULL, suggested_confidence = NULL, suggested_reason = NULL
      WHERE id = ANY(${withdraw}::uuid[]) AND NOT category_locked`;
  }

  return { byHistory, byPattern, withdrawn: withdraw.length };
}
