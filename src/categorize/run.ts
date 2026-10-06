/**
 * Categorization orchestrator (DESIGN.md §8).
 *
 * Deterministic end to end — no model, no network, no per-run cost. Every
 * guess is reviewed by a human anyway, so a model's extra accuracy would be
 * bought for rows that get looked at regardless.
 *
 * Passes, first claim wins:
 *
 *   1. income sources — registered payers. KNOWN, not guessed.
 *   2. rules          — the owner's own patterns, `rules` table.
 *   3. guesser        — past decisions, then built-in patterns (guess.ts).
 *   4. Uncategorized  — nothing fit, and the count says so.
 *
 * Every step carries the `NOT category_locked` guard — this function is the
 * one place to check when asking "can a machine pass clobber my work?" (I4).
 * The answer must stay no.
 *
 * Idempotent: safe to run any number of times over any date range.
 */
import type { Sql } from 'postgres';
import { linkMerchants, applyRules, applyDefaultCategory } from './rules';
import { applyIncomeSources } from './income-sources';
import { applyGuesses } from './guess-pass';
import { loadModel } from './history';

export interface CategorizeOptions {
  from?: string;
  to?: string;
  log?: (msg: string) => void;
}

export interface CategorizeReport {
  merchantsLinked: number;
  merchantsCreated: number;
  byIncomeSource: number;
  byRule: number;
  byHistory: number;
  byPattern: number;
  withdrawn: number;
  toUncategorized: number;
  lockedRowsUntouched: number;
}

export async function runCategorization(
  sql: Sql,
  opts: CategorizeOptions = {},
): Promise<CategorizeReport> {
  const log = opts.log ?? (() => {});
  const range = { from: opts.from, to: opts.to };

  const [{ locked }] = await sql<{ locked: number }[]>`
    SELECT count(*)::int AS locked FROM transactions WHERE category_locked`;

  log('· linking merchants');
  const merchants = await linkMerchants(sql, range);

  log('· income sources');
  const income = await applyIncomeSources(sql, range);

  log('· rules');
  const rules = await applyRules(sql, { ...range, exclude: income.claimed });
  for (const [name, n] of Object.entries(rules.byRule)) {
    if (n > 0) log(`  · ${name}: ${n}`);
  }

  log('· guessing from history and patterns');
  const model = await loadModel(sql);
  const guessed = await applyGuesses(sql, model, { ...range, exclude: rules.claimed });

  log('· default bucket');
  const fallback = await applyDefaultCategory(sql, range);

  // I4 verification, cheap enough to run every time: no locked row may have
  // been touched by any pass above.
  const [{ locked: lockedAfter }] = await sql<{ locked: number }[]>`
    SELECT count(*)::int AS locked FROM transactions WHERE category_locked`;
  if (lockedAfter < locked) {
    throw new Error(
      `I4 VIOLATION: locked transaction count fell from ${locked} to ${lockedAfter} ` +
      `during categorization. A machine pass is missing its NOT category_locked guard.`,
    );
  }

  return {
    merchantsLinked: merchants.linked,
    merchantsCreated: merchants.created,
    byIncomeSource: income.updated,
    byRule: rules.updated,
    byHistory: guessed.byHistory,
    byPattern: guessed.byPattern,
    withdrawn: guessed.withdrawn,
    toUncategorized: fallback.updated,
    lockedRowsUntouched: locked,
  };
}

/** One line for a log: what each pass filed this run. */
export function summarize(r: CategorizeReport): string {
  return `${r.byIncomeSource} by income source, ${r.byRule} by your rules, ` +
    `${r.byHistory} from history, ${r.byPattern} by pattern, ` +
    `${r.toUncategorized} to Uncategorized`;
}
