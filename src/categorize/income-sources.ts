/**
 * Income sources: "money from this payer is always X" (db/schema.sql).
 *
 * The first pass, ahead of rules and guessing, and only ever over inflows.
 * A match files the row as KNOWN — category_source = 'income_source' — so a
 * paycheck from a registered employer never waits in the review queue.
 *
 * A locked row is never touched (I4): if you filed one deposit differently by
 * hand, that decision stands.
 */
import type { Sql } from 'postgres';
import { collapse } from './heuristics';
import { parseAchPayer } from './payer';

export interface IncomeSource {
  id: string;
  name: string;
  match_payer: string | null;
  match_originator_id: string | null;
  category_id: string;
}

/**
 * The source this inflow came from, or null. Outflows never match: a payer
 * name appearing on money going OUT is a different relationship entirely.
 *
 * Payer text is matched as a case-insensitive substring of the
 * whitespace-collapsed description, so a CSV's padded columns and a feed's
 * single spaces read the same. The originator ID must match exactly.
 */
export function matchIncomeSource(
  rawDescription: string,
  amountCents: number,
  sources: IncomeSource[],
): IncomeSource | null {
  if (amountCents <= 0) return null;
  const text = collapse(rawDescription).toUpperCase();
  const originator = parseAchPayer(rawDescription)?.originatorId ?? null;

  for (const s of sources) {
    if (s.match_originator_id && originator === s.match_originator_id) return s;
    if (s.match_payer && text.includes(collapse(s.match_payer).toUpperCase())) return s;
  }
  return null;
}

export async function loadIncomeSources(sql: Sql): Promise<IncomeSource[]> {
  return sql<IncomeSource[]>`
    SELECT id, name, match_payer, match_originator_id, category_id
    FROM income_sources WHERE is_active
    ORDER BY created_at`;
}

/**
 * Files every unlocked inflow that matches a registered source. Returns the
 * ids it claimed — including rows already filed correctly — so later passes
 * leave them alone.
 */
export async function applyIncomeSources(
  sql: Sql,
  opts: { from?: string; to?: string } = {},
): Promise<{ claimed: Set<string>; updated: number }> {
  const sources = await loadIncomeSources(sql);
  const claimed = new Set<string>();
  if (sources.length === 0) return { claimed, updated: 0 };

  const rows = await sql<{ id: string; raw_description: string; eff_amount_cents: number }[]>`
    SELECT id, raw_description, eff_amount_cents FROM v_transactions
    WHERE NOT category_locked
      AND superseded_by_id IS NULL
      AND voided_at IS NULL
      AND eff_amount_cents > 0
      ${opts.from ? sql`AND eff_posted_date >= ${opts.from}::date` : sql``}
      ${opts.to ? sql`AND eff_posted_date <= ${opts.to}::date` : sql``}`;

  const ids: string[] = [];
  const categories: string[] = [];
  const reasons: string[] = [];
  for (const r of rows) {
    const s = matchIncomeSource(r.raw_description, Number(r.eff_amount_cents), sources);
    if (!s) continue;
    claimed.add(r.id);
    ids.push(r.id);
    categories.push(s.category_id);
    reasons.push(`income source: ${s.name}`);
  }
  if (ids.length === 0) return { claimed, updated: 0 };

  const updated = await sql<{ id: string }[]>`
    UPDATE transactions t SET
      category_id           = m.category_id,
      category_source       = 'income_source',
      suggested_category_id = m.category_id,
      suggested_confidence  = 1,
      suggested_reason      = m.reason
    FROM (
      SELECT unnest(${ids}::uuid[]) AS id,
             unnest(${categories}::uuid[]) AS category_id,
             unnest(${reasons}::text[]) AS reason
    ) m
    WHERE t.id = m.id
      AND NOT t.category_locked
      AND (t.category_id IS DISTINCT FROM m.category_id
           OR t.category_source <> 'income_source'
           OR t.suggested_reason IS DISTINCT FROM m.reason)
    RETURNING t.id`;

  return { claimed, updated: updated.length };
}
