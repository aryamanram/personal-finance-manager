/**
 * Transfer matching (INGEST_NOTES.md §3, M5).
 *
 * Pairs the two legs of a movement between your own accounts so neither counts
 * as spending. Above ~0.90 confidence it auto-links; below, it returns
 * candidates for a one-click confirmation in the UI.
 *
 * The Apple Card is the awkward case: it syncs monthly by file while Chase
 * syncs daily, so the two legs of an Apple Card payment can arrive weeks apart.
 * Hence WIDE_WINDOW_DAYS and the rule that this re-runs after CSV imports too,
 * not only after API syncs.
 */
import type { Sql } from 'postgres';

const DEFAULT_WINDOW_DAYS = 5;
/** Widened window for accounts that sync on a slower cadence than the other leg. */
const WIDE_WINDOW_DAYS = 45;
const AUTO_LINK_THRESHOLD = 0.9;

const TRANSFER_LANGUAGE = /payment|transfer|autopay|thank\s*you|online banking|epay|ach/i;

export interface TransferCandidate {
  aId: string;
  bId: string;
  aDescription: string;
  bDescription: string;
  aAccount: string;
  bAccount: string;
  amountCents: number;
  dayGap: number;
  confidence: number;
}

export interface MatchResult {
  linked: number;
  candidates: TransferCandidate[];
}

/**
 * Score a candidate pair. Date proximity and transfer-sounding language on both
 * legs are the two signals INGEST_NOTES calls for.
 */
export function scorePair(input: {
  dayGap: number;
  windowDays: number;
  aDescription: string;
  bDescription: string;
  sameInstitution: boolean;
}): number {
  const { dayGap, windowDays, aDescription, bDescription, sameInstitution } = input;

  // Proximity: same day is 1.0, decaying to 0 at the edge of the window.
  const proximity = Math.max(0, 1 - dayGap / Math.max(windowDays, 1));

  const aLang = TRANSFER_LANGUAGE.test(aDescription);
  const bLang = TRANSFER_LANGUAGE.test(bDescription);
  const language = aLang && bLang ? 1 : aLang || bLang ? 0.6 : 0.15;

  let score = 0.55 * proximity + 0.35 * language + (sameInstitution ? 0.1 : 0.05);

  // An exact same-day amount match with transfer language on both sides is as
  // certain as this gets without a shared reference number.
  if (dayGap === 0 && aLang && bLang) score = Math.max(score, 0.95);

  return Math.min(1, Math.round(score * 100) / 100);
}

export async function matchTransfers(
  sql: Sql,
  opts: { from?: string; to?: string; dryRun?: boolean; log?: (m: string) => void } = {},
): Promise<MatchResult> {
  const log = opts.log ?? (() => {});

  // Candidate pairs: equal and opposite, different accounts, unlinked, within
  // the wider of the two accounts' windows. Generated in SQL because the
  // self-join is what makes this cheap.
  const rows = await sql<{
    a_id: string; b_id: string; a_desc: string; b_desc: string;
    a_account: string; b_account: string; amount_cents: number;
    day_gap: number; same_institution: boolean; window_days: number;
  }[]>`
    SELECT
      a.id AS a_id, b.id AS b_id,
      a.eff_description AS a_desc, b.eff_description AS b_desc,
      a.account_name AS a_account, b.account_name AS b_account,
      a.eff_amount_cents AS amount_cents,
      abs(a.eff_posted_date - b.eff_posted_date) AS day_gap,
      (aa.institution_id IS NOT DISTINCT FROM ba.institution_id) AS same_institution,
      GREATEST(
        CASE WHEN aa.source = 'csv' THEN ${WIDE_WINDOW_DAYS}::int ELSE ${DEFAULT_WINDOW_DAYS}::int END,
        CASE WHEN ba.source = 'csv' THEN ${WIDE_WINDOW_DAYS}::int ELSE ${DEFAULT_WINDOW_DAYS}::int END
      ) AS window_days
    FROM v_transactions a
    JOIN v_transactions b
      ON a.eff_amount_cents = -b.eff_amount_cents
     AND a.account_id <> b.account_id
     -- Each unordered pair appears exactly once because the a-side is pinned
     -- to the OUTFLOW leg below. Do NOT also order by id here: id order and
     -- sign order are independent, so combining them silently drops every pair
     -- whose outflow row happens to sort after its inflow row.
     AND a.id <> b.id
    JOIN accounts aa ON aa.id = a.account_id
    JOIN accounts ba ON ba.id = b.account_id
    WHERE a.transfer_id IS NULL AND b.transfer_id IS NULL
      AND a.voided_at IS NULL AND b.voided_at IS NULL
      AND a.superseded_by_id IS NULL AND b.superseded_by_id IS NULL
      AND a.eff_amount_cents < 0          -- a is always the outflow leg
      AND abs(a.eff_posted_date - b.eff_posted_date) <= GREATEST(
            CASE WHEN aa.source = 'csv' THEN ${WIDE_WINDOW_DAYS}::int ELSE ${DEFAULT_WINDOW_DAYS}::int END,
            CASE WHEN ba.source = 'csv' THEN ${WIDE_WINDOW_DAYS}::int ELSE ${DEFAULT_WINDOW_DAYS}::int END)
      ${opts.from ? sql`AND a.eff_posted_date >= ${opts.from}::date` : sql``}
      ${opts.to ? sql`AND a.eff_posted_date <= ${opts.to}::date` : sql``}
    ORDER BY abs(a.eff_posted_date - b.eff_posted_date)`;

  const scored: TransferCandidate[] = rows.map((r) => ({
    aId: r.a_id,
    bId: r.b_id,
    aDescription: r.a_desc,
    bDescription: r.b_desc,
    aAccount: r.a_account,
    bAccount: r.b_account,
    amountCents: r.amount_cents,
    dayGap: Number(r.day_gap),
    confidence: scorePair({
      dayGap: Number(r.day_gap),
      windowDays: Number(r.window_days),
      aDescription: r.a_desc,
      bDescription: r.b_desc,
      sameInstitution: r.same_institution,
    }),
  }));

  scored.sort((x, y) => y.confidence - x.confidence);

  const result: MatchResult = { linked: 0, candidates: [] };
  const used = new Set<string>();

  for (const c of scored) {
    // A transaction can only be one leg of one transfer. Greedy over the
    // confidence-sorted list, so the best pairing for a row wins.
    if (used.has(c.aId) || used.has(c.bId)) continue;

    if (c.confidence >= AUTO_LINK_THRESHOLD) {
      used.add(c.aId);
      used.add(c.bId);
      if (!opts.dryRun) {
        await linkPair(sql, c.aId, c.bId, 'auto', c.confidence);
      }
      result.linked++;
      log(`  · linked ${c.aAccount} -> ${c.bAccount} (${c.confidence})`);
    } else {
      result.candidates.push(c);
    }
  }

  return result;
}

/** Create the transfers row and point both legs at it. */
export async function linkPair(
  sql: Sql,
  aId: string,
  bId: string,
  matchedBy: 'auto' | 'manual',
  confidence: number | null = null,
): Promise<string> {
  const [transfer] = await sql<{ id: string }[]>`
    INSERT INTO transfers (matched_by, confidence)
    VALUES (${matchedBy}, ${matchedBy === 'auto' ? confidence : null})
    RETURNING id`;

  await sql`
    UPDATE transactions SET transfer_id = ${transfer.id} WHERE id IN (${aId}, ${bId})`;

  return transfer.id;
}

/** Unlink both legs and drop the transfers row. */
export async function unlinkTransfer(sql: Sql, transferId: string): Promise<void> {
  await sql`UPDATE transactions SET transfer_id = NULL WHERE transfer_id = ${transferId}`;
  await sql`DELETE FROM transfers WHERE id = ${transferId}`;
}
