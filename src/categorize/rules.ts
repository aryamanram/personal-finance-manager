/**
 * Deterministic categorization (DESIGN.md §8, steps 1-2).
 *
 * Order: merchant default, then rules by ascending priority, first match wins.
 * EVERY query here carries `AND NOT category_locked` (I4).
 */
import type { Sql } from 'postgres';

/** The guard that makes I4 true. Never write a batch update without it. */
export const NOT_LOCKED = 'NOT category_locked';

/**
 * Bank exports pad descriptions with runs of spaces to align fixed-width
 * columns: Chase writes "VENMO            CASHOUT" in a CSV where its API
 * returns "VENMO CASHOUT". A rule written against one form silently matches
 * nothing in the other, and a rule that matches nothing looks exactly like a
 * rule that had nothing to match.
 *
 * So rules are evaluated against a whitespace-collapsed description AND against
 * the raw one. Collapsing only would break the mirror-image case: a pattern
 * written with the literal repeated spaces it saw in a CSV can never match the
 * collapsed form, so that rule would quietly stop claiming its rows and a
 * lower-priority rule would take them.
 */
const COLLAPSED = 'regexp_replace(t.raw_description, \'\\s+\', \' \', \'g\')';

export interface Rule {
  id: string;
  name: string;
  priority: number;
  match_regex: string | null;
  match_account_id: string | null;
  match_amount_min: number | null;
  match_amount_max: number | null;
  set_category_id: string | null;
  set_merchant_id: string | null;
  set_cost_type: string | null;
  set_necessity: string | null;
}

export interface PassResult {
  examined: number;
  updated: number;
  skippedLocked: number;
}



/**
 * Step 2 — rules, in priority order, first match wins.
 *
 * Applied one rule at a time from lowest priority number up, and each pass only
 * touches rows still uncategorized by an earlier rule in the same run. That is
 * what makes "first match wins" true without needing a correlated subquery.
 */
export async function applyRules(
  sql: Sql,
  opts: { from?: string; to?: string } = {},
): Promise<PassResult & { byRule: Record<string, number> }> {
  const rules = await sql<Rule[]>`
    SELECT * FROM rules WHERE is_active ORDER BY priority ASC, created_at ASC`;

  const byRule: Record<string, number> = {};
  let updated = 0;
  const alreadyMatched = new Set<string>();

  for (const rule of rules) {
    if (!rule.set_category_id && !rule.set_cost_type && !rule.set_necessity && !rule.set_merchant_id) {
      continue;
    }

    // "First match wins" is enforced by excluding rows an earlier rule already
    // claimed THIS RUN. A rule must claim a row it matches even when it has
    // nothing to write (the value is already correct) — otherwise a lower
    // priority rule would overwrite what a higher priority rule established.
    const claimed = await sql<{ id: string }[]>`
      SELECT t.id FROM transactions t
      WHERE NOT t.category_locked
        AND t.superseded_by_id IS NULL
        AND t.voided_at IS NULL
        ${alreadyMatched.size > 0
          ? sql`AND t.id <> ALL(${Array.from(alreadyMatched)}::uuid[])`
          : sql``}
        ${rule.match_regex
          ? sql`AND (t.raw_description ~* ${rule.match_regex}
                     OR ${sql.unsafe(COLLAPSED)} ~* ${rule.match_regex})`
          : sql``}
        ${rule.match_account_id ? sql`AND t.account_id = ${rule.match_account_id}` : sql``}
        ${rule.match_amount_min !== null ? sql`AND t.amount_cents >= ${rule.match_amount_min}` : sql``}
        ${rule.match_amount_max !== null ? sql`AND t.amount_cents <= ${rule.match_amount_max}` : sql``}
        ${opts.from ? sql`AND t.posted_date >= ${opts.from}::date` : sql``}
        ${opts.to ? sql`AND t.posted_date <= ${opts.to}::date` : sql``}`;

    const matched = await sql<{ id: string }[]>`
      UPDATE transactions t SET
        category_id     = COALESCE(${rule.set_category_id}::uuid, t.category_id),
        category_source = CASE WHEN ${rule.set_category_id}::uuid IS NOT NULL
                               THEN 'rule'::category_source ELSE t.category_source END,
        merchant_id     = COALESCE(${rule.set_merchant_id}::uuid, t.merchant_id),
        cost_type_override = COALESCE(${rule.set_cost_type}::cost_type, t.cost_type_override),
        necessity_override = COALESCE(${rule.set_necessity}::necessity, t.necessity_override)
      WHERE NOT t.category_locked
        AND t.superseded_by_id IS NULL
        AND t.voided_at IS NULL
        -- Idempotence: skip rows this rule would write its own values to.
        -- Without this, every run rewrites every matched row, churning
        -- updated_at and making "did anything change?" unanswerable.
        AND (
          (${rule.set_category_id}::uuid IS NOT NULL
             AND t.category_id IS DISTINCT FROM ${rule.set_category_id}::uuid)
          OR (${rule.set_merchant_id}::uuid IS NOT NULL
             AND t.merchant_id IS DISTINCT FROM ${rule.set_merchant_id}::uuid)
          OR (${rule.set_cost_type}::cost_type IS NOT NULL
             AND t.cost_type_override IS DISTINCT FROM ${rule.set_cost_type}::cost_type)
          OR (${rule.set_necessity}::necessity IS NOT NULL
             AND t.necessity_override IS DISTINCT FROM ${rule.set_necessity}::necessity)
        )
        ${alreadyMatched.size > 0
          ? sql`AND t.id <> ALL(${Array.from(alreadyMatched)}::uuid[])`
          : sql``}
        ${rule.match_regex
          ? sql`AND (t.raw_description ~* ${rule.match_regex}
                     OR ${sql.unsafe(COLLAPSED)} ~* ${rule.match_regex})`
          : sql``}
        ${rule.match_account_id ? sql`AND t.account_id = ${rule.match_account_id}` : sql``}
        ${rule.match_amount_min !== null ? sql`AND t.amount_cents >= ${rule.match_amount_min}` : sql``}
        ${rule.match_amount_max !== null ? sql`AND t.amount_cents <= ${rule.match_amount_max}` : sql``}
        ${opts.from ? sql`AND t.posted_date >= ${opts.from}::date` : sql``}
        ${opts.to ? sql`AND t.posted_date <= ${opts.to}::date` : sql``}
      RETURNING t.id`;

    // Claim everything this rule matched, not just what it changed.
    for (const r of claimed) alreadyMatched.add(r.id);
    byRule[rule.name] = matched.length;
    updated += matched.length;
  }

  return { examined: updated, updated, skippedLocked: 0, byRule };
}

/**
 * Step 4 — everything still uncategorized lands in Uncategorized so the
 * dashboard's "Uncategorized: N" number is honest.
 */
export async function applyDefaultCategory(
  sql: Sql,
  opts: { from?: string; to?: string } = {},
): Promise<PassResult> {
  const rows = await sql<{ id: string }[]>`
    UPDATE transactions t
    SET category_id = c.id, category_source = 'default'
    FROM categories c
    WHERE c.name = 'Uncategorized'
      AND t.category_id IS NULL
      AND NOT t.category_locked
      AND t.superseded_by_id IS NULL
      AND t.voided_at IS NULL
      ${opts.from ? sql`AND t.posted_date >= ${opts.from}::date` : sql``}
      ${opts.to ? sql`AND t.posted_date <= ${opts.to}::date` : sql``}
    RETURNING t.id`;

  return { examined: rows.length, updated: rows.length, skippedLocked: 0 };
}

/**
 * Attach a merchant to every transaction that lacks one, creating merchant rows
 * on first sight. Runs before categorization so merchant defaults can apply.
 */
export async function linkMerchants(
  sql: Sql,
  opts: { from?: string; to?: string } = {},
): Promise<{ linked: number; created: number }> {
  const { merchantKey, merchantDisplayName } = await import('../ingest/fingerprint');

  const rows = await sql<{ id: string; raw_description: string }[]>`
    SELECT id, raw_description FROM transactions
    WHERE merchant_id IS NULL
      AND superseded_by_id IS NULL
      AND voided_at IS NULL
      ${opts.from ? sql`AND posted_date >= ${opts.from}::date` : sql``}
      ${opts.to ? sql`AND posted_date <= ${opts.to}::date` : sql``}`;

  // Group by key so each distinct merchant is resolved once, not once per row.
  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    const key = merchantKey(r.raw_description);
    if (!key) continue;
    const g = byKey.get(key);
    if (g) g.push(r.id);
    else byKey.set(key, [r.id]);
  }

  let created = 0;
  let linked = 0;

  for (const [key, ids] of byKey) {
    const [m] = await sql<{ id: string; inserted: boolean }[]>`
      WITH existing AS (SELECT id FROM merchants WHERE normalized_name = ${key}),
      ins AS (
        INSERT INTO merchants (normalized_name, display_name)
        SELECT ${key}, ${merchantDisplayName(key)}
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT (normalized_name) DO NOTHING
        RETURNING id
      )
      SELECT id, TRUE AS inserted FROM ins
      UNION ALL SELECT id, FALSE AS inserted FROM existing
      LIMIT 1`;

    if (!m) continue;
    if (m.inserted) created++;

    await sql`UPDATE transactions SET merchant_id = ${m.id} WHERE id = ANY(${ids}::uuid[])`;
    linked += ids.length;
  }

  return { linked, created };
}
