/**
 * The ingest write path. Implements INGEST_NOTES.md §1 and §2.
 *
 * Three properties this must hold, all of which have tests:
 *   I7 — re-importing the same file inserts nothing new (counting dedup)
 *   I8 — a CSV row and a later API row for the same real transaction resolve
 *        to ONE row via adoption, not two
 *   §2 — a pending row that posts carries its categorization forward
 *
 * Idempotent. Safe to run over any date range any number of times.
 */
import type { Sql, TransactionSql } from 'postgres';
import type { CanonicalTxn } from '../lib/types';
import { fingerprint, normalize } from './fingerprint';

export interface UpsertResult {
  seen: number;
  inserted: number;
  duplicate: number;
  updated: number;
  adopted: number;
  superseded: number;
}

interface Prepared extends CanonicalTxn {
  fp: string;
}

/** Days a pending row may differ from its posted version. */
const SUPERSEDE_DAY_WINDOW = 5;

/**
 * Days a CSV row may differ from the synced row describing the same charge.
 *
 * Two, not five: this pass matches on amount and a description prefix, so a
 * wider window would start merging a genuinely repeated charge — the same
 * subscription billed twice in a week — into one row.
 */
const ADOPT_DAY_WINDOW = 2;
/** Fractional amount drift allowed pending→posted (tips, gas pre-auths). */
const SUPERSEDE_AMOUNT_TOLERANCE = 0.25;

/**
 * Two descriptions of the same charge: one normalize()d form is a prefix of
 * the other. A prefix cannot match two unrelated merchants, where looser
 * tests can. Shared by fuzzy adoption and pending supersession so the ingest
 * path has one definition of "the same description".
 */
function sameDescription(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length === 0 || nb.length === 0) return false;
  return na.startsWith(nb) || nb.startsWith(na);
}

export async function upsertTransactions(
  sql: Sql,
  rows: CanonicalTxn[],
  opts: { importBatchId?: string | null } = {},
): Promise<UpsertResult> {
  const result: UpsertResult = {
    seen: rows.length,
    inserted: 0,
    duplicate: 0,
    updated: 0,
    adopted: 0,
    superseded: 0,
  };
  if (rows.length === 0) return result;

  const prepared: Prepared[] = rows.map((r) => ({
    ...r,
    fp: fingerprint({
      accountId: r.accountId,
      postedDate: r.postedDate,
      amountCents: r.amountCents,
      rawDescription: r.rawDescription,
    }),
  }));

  await sql.begin(async (tx) => {
    // Rows adopted during THIS run must not be adopted twice (INGEST_NOTES §1
    // step 2: "not already adopted this run").
    const claimed = new Set<string>();

    // --- Pass 1: rows carrying an external_id -----------------------------
    // The aggregator id is authoritative, but a match on it is not enough —
    // a CSV backfill has no external_id and would double-count. Three steps.
    const withExternal = prepared.filter((r) => r.externalId);

    for (const row of withExternal) {
      // Step 1: known external_id -> update in place.
      const existing = await tx<{ id: string }[]>`
        SELECT id FROM transactions
        WHERE account_id = ${row.accountId} AND external_id = ${row.externalId!}
        LIMIT 1`;

      if (existing.length > 0) {
        await tx`
          UPDATE transactions SET
            amount_cents    = ${row.amountCents},
            posted_date     = ${row.postedDate},
            authorized_date = ${row.authorizedDate ?? null},
            status          = ${row.status},
            raw_description = ${row.rawDescription},
            fingerprint     = ${row.fp}
          WHERE id = ${existing[0].id}`;
        result.updated++;
        claimed.add(existing[0].id);
        continue;
      }

      // Step 2: adoption. A CSV row describing this same transaction gets
      // claimed, keeping whatever categorization was already done to it.
      const adoptable = await tx<{ id: string }[]>`
        SELECT id FROM transactions
        WHERE account_id = ${row.accountId}
          AND fingerprint = ${row.fp}
          AND external_id IS NULL
          AND voided_at IS NULL
          AND superseded_by_id IS NULL
          ${claimed.size > 0 ? tx`AND id <> ALL(${Array.from(claimed)}::uuid[])` : tx``}
        ORDER BY created_at
        LIMIT 1`;

      if (adoptable.length > 0) {
        // Deliberately does NOT touch category, overrides, or locks.
        await tx`
          UPDATE transactions
          SET external_id = ${row.externalId!},
              source      = ${row.source},
              status      = ${row.status}
          WHERE id = ${adoptable[0].id}`;
        result.adopted++;
        claimed.add(adoptable[0].id);
        continue;
      }

      // Step 2b: fuzzy adoption, for when the fingerprint cannot match.
      //
      // The fingerprint needs the normalized description AND the date to be
      // identical. A bank's own feed and its CSV export routinely disagree on
      // both: one charge arrived as
      //
      //   CSV   POS DEBIT  <MERCHANT>  +1385... CA      on the 16th
      //   SYNC  <MERCHANT> BR <MERCHANT-DOMAIN> CA      on the 17th
      //
      // — the feed repeats the merchant's domain, and posts a day later. Two
      // rows for one $15 charge, and it had also split the categorisation:
      // the CSV row was filed by hand, the synced one by a rule.
      //
      // So: same account, EXACT same amount, within two days, no external_id,
      // and a shared merchant key. Amount is the strict part — this never
      // merges two different amounts, which is what keeps it from inventing a
      // reconciliation error. The merchant key is what stops two genuinely
      // separate $15 charges in one week from collapsing into one.
      const candidates = await tx<{ id: string; raw_description: string }[]>`
        SELECT id, raw_description FROM transactions
        WHERE account_id = ${row.accountId}
          AND amount_cents = ${row.amountCents}
          AND external_id IS NULL
          AND voided_at IS NULL
          AND superseded_by_id IS NULL
          AND abs(posted_date - ${row.postedDate}::date) <= ${ADOPT_DAY_WINDOW}
          ${claimed.size > 0 ? tx`AND id <> ALL(${Array.from(claimed)}::uuid[])` : tx``}
        ORDER BY abs(posted_date - ${row.postedDate}::date), created_at`;

      // The prefix test runs HERE, not in SQL: normalize() is TypeScript, and
      // reimplementing it as a SQL expression would give the ingest path two
      // definitions of "the same description" that could drift apart.
      const fuzzy = candidates.filter((c) => sameDescription(c.raw_description, row.rawDescription));

      if (fuzzy.length > 0) {
        await tx`
          UPDATE transactions
          SET external_id = ${row.externalId!},
              source      = ${row.source},
              status      = ${row.status}
          WHERE id = ${fuzzy[0].id}`;
        result.adopted++;
        claimed.add(fuzzy[0].id);
        continue;
      }

      // Step 3: genuinely new.
      const [ins] = await tx<{ id: string }[]>`
        INSERT INTO transactions ${tx(insertRow(row, opts.importBatchId))}
        RETURNING id`;
      result.inserted++;
      claimed.add(ins.id);
    }

    // --- Pass 2: rows without an external_id (CSV) ------------------------
    // Counting dedup: insert max(0, n_file - n_existing) per fingerprint group.
    // Existence checks are wrong here — two identical $4.50 coffees on the
    // same day are not duplicates.
    const withoutExternal = prepared.filter((r) => !r.externalId);
    const groups = new Map<string, Prepared[]>();
    for (const row of withoutExternal) {
      const key = `${row.accountId}|${row.fp}`;
      const g = groups.get(key);
      if (g) g.push(row);
      else groups.set(key, [row]);
    }

    for (const group of groups.values()) {
      const [{ count: nExisting }] = await tx<{ count: number }[]>`
        SELECT count(*)::int FROM transactions
        WHERE account_id = ${group[0].accountId}
          AND fingerprint = ${group[0].fp}
          AND voided_at IS NULL`;

      const toInsert = Math.max(0, group.length - nExisting);
      result.duplicate += group.length - toInsert;

      for (const row of group.slice(0, toInsert)) {
        const [ins] = await tx<{ id: string }[]>`
          INSERT INTO transactions ${tx(insertRow(row, opts.importBatchId))}
          RETURNING id`;
        result.inserted++;
        claimed.add(ins.id);
      }
    }

    // --- Pass 3: pending -> posted supersession ---------------------------
    result.superseded = await supersedePending(tx, prepared, claimed);
  });

  return result;
}

/**
 * INGEST_NOTES §2. For each newly posted row, find an unmatched pending row for
 * the same real transaction and carry its categorization forward. Without this,
 * every decision made on a pending transaction evaporates when it posts.
 *
 * Usually the bank stops listing a pending row once it posts, and the match
 * can be loose: ±5 days, amount within 25% for tips and fuel holds. But some
 * charges arrive with the authorization hold STILL listed beside the posted
 * charge, each under its own id, in the same response — and a hold the bank
 * is still listing could also be a second, separate purchase. So a pending
 * row this run touched is superseded only on stronger evidence: exactly the
 * same amount and the same description.
 */
async function supersedePending(
  tx: TransactionSql<{}>,
  prepared: Prepared[],
  claimed: Set<string>,
): Promise<number> {
  const postedIds = Array.from(claimed);
  if (postedIds.length === 0) return 0;

  const posted = await tx<
    { id: string; account_id: string; posted_date: string; amount_cents: number; raw_description: string }[]
  >`
    SELECT id, account_id, posted_date, amount_cents, raw_description
    FROM transactions
    WHERE id = ANY(${postedIds}::uuid[])
      AND status = 'posted'
      AND superseded_by_id IS NULL`;

  let count = 0;

  for (const row of posted) {
    const lo = Math.min(
      Math.round(row.amount_cents * (1 - SUPERSEDE_AMOUNT_TOLERANCE)),
      Math.round(row.amount_cents * (1 + SUPERSEDE_AMOUNT_TOLERANCE)),
    );
    const hi = Math.max(
      Math.round(row.amount_cents * (1 - SUPERSEDE_AMOUNT_TOLERANCE)),
      Math.round(row.amount_cents * (1 + SUPERSEDE_AMOUNT_TOLERANCE)),
    );

    const candidates = await tx<{ id: string; amount_cents: number; raw_description: string }[]>`
      SELECT id, amount_cents, raw_description FROM transactions
      WHERE account_id = ${row.account_id}
        AND status = 'pending'
        AND superseded_by_id IS NULL
        AND voided_at IS NULL
        AND id <> ${row.id}
        AND amount_cents BETWEEN ${lo} AND ${hi}
        AND abs(posted_date - ${row.posted_date}::date) <= ${SUPERSEDE_DAY_WINDOW}
      ORDER BY abs(posted_date - ${row.posted_date}::date),
               abs(amount_cents - ${row.amount_cents})`;

    // A pending row the bank no longer lists has posted: the loose match
    // stands. One it still lists in this very response needs the exact amount
    // and the same description to count as this charge's hold.
    const candidate = candidates.find((c) =>
      !claimed.has(c.id)
      || (Number(c.amount_cents) === Number(row.amount_cents)
          && sameDescription(c.raw_description, row.raw_description)));

    if (!candidate) continue;

    // Carry the human's work forward onto the posted row, then mark the
    // pending row superseded. Every view filters superseded_by_id IS NULL.
    await tx`
      UPDATE transactions posted SET
        category_id           = COALESCE(pending.category_id, posted.category_id),
        category_source       = CASE WHEN pending.category_id IS NOT NULL
                                     THEN pending.category_source
                                     ELSE posted.category_source END,
        category_locked       = pending.category_locked OR posted.category_locked,
        cost_type_override    = COALESCE(pending.cost_type_override, posted.cost_type_override),
        necessity_override    = COALESCE(pending.necessity_override, posted.necessity_override),
        merchant_id           = COALESCE(pending.merchant_id, posted.merchant_id),
        description           = COALESCE(pending.description, posted.description),
        notes                 = COALESCE(pending.notes, posted.notes),
        exclude_from_totals   = pending.exclude_from_totals OR posted.exclude_from_totals,
        destination_account_id = COALESCE(pending.destination_account_id, posted.destination_account_id)
      FROM transactions pending
      WHERE posted.id = ${row.id} AND pending.id = ${candidate.id}`;

    await tx`
      UPDATE transactions SET superseded_by_id = ${row.id} WHERE id = ${candidate.id}`;
    count++;
  }

  return count;
}

function insertRow(row: Prepared, importBatchId?: string | null) {
  return {
    account_id: row.accountId,
    amount_cents: row.amountCents,
    currency: row.currency ?? 'USD',
    posted_date: row.postedDate,
    authorized_date: row.authorizedDate ?? null,
    status: row.status,
    raw_description: row.rawDescription,
    source: row.source,
    external_id: row.externalId ?? null,
    fingerprint: row.fp,
    import_batch_id: importBatchId ?? null,
  };
}
