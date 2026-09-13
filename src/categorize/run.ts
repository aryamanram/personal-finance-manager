/**
 * Categorization orchestrator (DESIGN.md §8).
 *
 * Runs the four steps in precedence order. Every step carries the
 * `NOT category_locked` guard — this function is the one place to check when
 * asking "can a machine pass clobber my work?" (I4). The answer must stay no.
 *
 * Idempotent: safe to run any number of times over any date range.
 */
import type { Sql } from 'postgres';
import { linkMerchants, applyMerchantDefaults, applyRules, applyDefaultCategory } from './rules';
import { categorizeWithLlm } from './llm';

export interface CategorizeOptions {
  from?: string;
  to?: string;
  /** Skip the LLM step even when an API key is present. */
  noLlm?: boolean;
  log?: (msg: string) => void;
}

export interface CategorizeReport {
  merchantsLinked: number;
  merchantsCreated: number;
  byMerchantDefault: number;
  byRule: number;
  byLlm: number;
  toUncategorized: number;
  lockedRowsUntouched: number;
  llmSkipped: string | null;
  errors: string[];
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

  log('· merchant defaults');
  const defaults = await applyMerchantDefaults(sql, range);

  log('· rules');
  const rules = await applyRules(sql, range);
  for (const [name, n] of Object.entries(rules.byRule)) {
    if (n > 0) log(`  · ${name}: ${n}`);
  }

  let llmUpdated = 0;
  let llmSkipped: string | null = null;
  const errors: string[] = [];

  if (!opts.noLlm) {
    log('· llm fallback');
    const llm = await categorizeWithLlm(sql, { ...range, log });
    llmUpdated = llm.transactionsUpdated;
    llmSkipped = llm.skipped;
    errors.push(...llm.errors);
    if (llm.skipped === 'no-api-key') {
      log('  · skipped: ANTHROPIC_API_KEY not set');
    }
  }

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
    byMerchantDefault: defaults.updated,
    byRule: rules.updated,
    byLlm: llmUpdated,
    toUncategorized: fallback.updated,
    lockedRowsUntouched: locked,
    llmSkipped,
    errors,
  };
}

/**
 * Always populate suggested_category_id, even where a lock prevents applying it
 * (DESIGN.md §8). This is the signal for "which rules are worth writing?" —
 * a locked row whose suggestion disagrees with the human is exactly the case
 * where a rule would have saved the manual edit.
 */
export async function refreshSuggestions(sql: Sql): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE transactions t
    SET suggested_category_id = m.default_category_id
    FROM merchants m
    WHERE t.merchant_id = m.id
      AND m.default_category_id IS NOT NULL
      AND t.superseded_by_id IS NULL
      AND t.suggested_category_id IS DISTINCT FROM m.default_category_id
    RETURNING t.id`;
  return rows.length;
}
