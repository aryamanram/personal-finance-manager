/**
 * The invariants that make the ledger trustworthy. Every one of these maps to a
 * numbered invariant in DESIGN.md §2.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Sql } from 'postgres';
import { createTestDb, seedAccounts, categoryByName } from './helpers/db';
import { upsertTransactions } from '@/ingest/upsert';
import { parseAppleCardCsv, toCanonical } from '@/ingest/applecard-csv';
import type { CanonicalTxn } from '@/lib/types';

let sql: Sql;
let drop: () => Promise<void>;
let acct: Awaited<ReturnType<typeof seedAccounts>>;

beforeAll(async () => {
  const db = await createTestDb('ingest');
  sql = db.sql;
  drop = db.drop;
  acct = await seedAccounts(sql);
}, 30_000);

afterAll(async () => { await drop(); });

async function countTxns(accountId?: string): Promise<number> {
  const rows = accountId
    ? await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM transactions WHERE account_id = ${accountId}`
    : await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM transactions`;
  return rows[0].c;
}

describe('I7 — re-importing the same file is a no-op', () => {
  it('imports a CSV twice and inserts nothing the second time', async () => {
    const csv = readFileSync('fixtures/applecard-negative.csv', 'utf8');
    const rows = toCanonical(parseAppleCardCsv(csv).rows, acct.appleId);

    const first = await upsertTransactions(sql, rows);
    expect(first.inserted).toBe(7);
    const afterFirst = await countTxns(acct.appleId);

    const second = await upsertTransactions(sql, rows);
    expect(second.inserted).toBe(0);
    expect(second.duplicate).toBe(7);
    expect(await countTxns(acct.appleId)).toBe(afterFirst);

    // A third time, for good measure — this is the failure mode that silently
    // doubles a month of spending.
    await upsertTransactions(sql, rows);
    expect(await countTxns(acct.appleId)).toBe(afterFirst);
  });

  it('keeps two genuinely identical coffees as two rows', async () => {
    // The fixture has two $4.50 Starbucks charges on the same day.
    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM transactions
      WHERE account_id = ${acct.appleId} AND amount_cents = -450`;
    expect(c).toBe(2);

    // ...and they are distinguished by fingerprint_seq, not by being merged.
    const seqs = await sql<{ fingerprint_seq: number }[]>`
      SELECT fingerprint_seq FROM transactions
      WHERE account_id = ${acct.appleId} AND amount_cents = -450
      ORDER BY fingerprint_seq`;
    expect(seqs.map((s) => s.fingerprint_seq)).toEqual([1, 2]);
  });

  it('inserts only the delta when a later statement extends an earlier one', async () => {
    const base = readFileSync('fixtures/applecard-negative.csv', 'utf8');
    const extended = base + '08/25/2026,Transaction,NEW MERCHANT LLC,2%,$0.20,-9.99\n';
    const rows = toCanonical(parseAppleCardCsv(extended).rows, acct.appleId);

    const before = await countTxns(acct.appleId);
    const r = await upsertTransactions(sql, rows);
    expect(r.inserted).toBe(1);
    expect(await countTxns(acct.appleId)).toBe(before + 1);
  });
});

describe('I8 — CSV backfill and API sync must not double-count', () => {
  it('adopts a hand-imported CSV row rather than inserting a second copy', async () => {
    const csvRow: CanonicalTxn = {
      accountId: acct.explorerId,
      amountCents: -5400,
      postedDate: '2026-07-14',
      status: 'posted',
      rawDescription: 'UNITED AIRLINES 0162345678',
      source: 'csv',
      externalId: null,
    };
    await upsertTransactions(sql, [csvRow]);

    // The user categorizes it by hand.
    const flights = await categoryByName(sql, 'Flights');
    await sql`
      UPDATE transactions
      SET category_id = ${flights}, category_source = 'manual', notes = 'work trip'
      WHERE account_id = ${acct.explorerId} AND external_id IS NULL`;

    const before = await countTxns(acct.explorerId);

    // Now the API sync window overlaps that date and returns the same txn.
    const apiRow: CanonicalTxn = { ...csvRow, source: 'simplefin', externalId: 'sf-united-1' };
    const r = await upsertTransactions(sql, [apiRow]);

    expect(r.adopted).toBe(1);
    expect(r.inserted).toBe(0);
    expect(await countTxns(acct.explorerId)).toBe(before);

    // Adoption must not disturb the categorization already done to it.
    const [adopted] = await sql<
      { external_id: string; category_id: string; category_locked: boolean; notes: string; source: string }[]
    >`SELECT external_id, category_id, category_locked, notes, source
      FROM transactions WHERE account_id = ${acct.explorerId}`;
    expect(adopted.external_id).toBe('sf-united-1');
    expect(adopted.source).toBe('simplefin');
    expect(adopted.category_id).toBe(flights);
    expect(adopted.category_locked).toBe(true);
    expect(adopted.notes).toBe('work trip');
  });

  it('updates in place on a repeat sync of the same external_id', async () => {
    const apiRow: CanonicalTxn = {
      accountId: acct.explorerId,
      amountCents: -5400,
      postedDate: '2026-07-14',
      status: 'posted',
      rawDescription: 'UNITED AIRLINES 0162345678',
      source: 'simplefin',
      externalId: 'sf-united-1',
    };
    const before = await countTxns(acct.explorerId);
    const r = await upsertTransactions(sql, [apiRow]);
    expect(r.updated).toBe(1);
    expect(r.inserted).toBe(0);
    expect(await countTxns(acct.explorerId)).toBe(before);
  });

  it('does not adopt the same CSV row twice within one run', async () => {
    // Two distinct API transactions that fingerprint identically (two real
    // $12.00 charges) must not both adopt the single CSV row.
    const csvRow: CanonicalTxn = {
      accountId: acct.checkingId,
      amountCents: -1200,
      postedDate: '2026-07-20',
      status: 'posted',
      rawDescription: 'DUPLICATE TEST MERCHANT',
      source: 'csv',
      externalId: null,
    };
    await upsertTransactions(sql, [csvRow]);

    const r = await upsertTransactions(sql, [
      { ...csvRow, source: 'simplefin', externalId: 'sf-dup-a' },
      { ...csvRow, source: 'simplefin', externalId: 'sf-dup-b' },
    ]);

    expect(r.adopted).toBe(1);
    expect(r.inserted).toBe(1);
    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM transactions
      WHERE account_id = ${acct.checkingId} AND amount_cents = -1200`;
    expect(c).toBe(2);
  });
});

describe('pending -> posted supersession', () => {
  it('carries the category forward and hides the pending row', async () => {
    const pending: CanonicalTxn = {
      accountId: acct.checkingId,
      amountCents: -4200,
      postedDate: '2026-08-10',
      status: 'pending',
      rawDescription: 'LOCAL DINER 5512',
      source: 'simplefin',
      externalId: 'sf-pending-1',
    };
    await upsertTransactions(sql, [pending]);

    const restaurants = await categoryByName(sql, 'Restaurants');
    await sql`
      UPDATE transactions SET category_id = ${restaurants}, category_source = 'manual'
      WHERE external_id = 'sf-pending-1'`;

    // It posts two days later, with a tip, under a new aggregator id.
    const posted: CanonicalTxn = {
      ...pending,
      amountCents: -4900,
      postedDate: '2026-08-12',
      status: 'posted',
      externalId: 'sf-posted-1',
    };
    const r = await upsertTransactions(sql, [posted]);
    expect(r.superseded).toBe(1);

    const [p] = await sql<{ superseded_by_id: string | null }[]>`
      SELECT superseded_by_id FROM transactions WHERE external_id = 'sf-pending-1'`;
    expect(p.superseded_by_id).not.toBeNull();

    // The whole point: the categorization survived.
    const [post] = await sql<{ category_id: string; category_locked: boolean }[]>`
      SELECT category_id, category_locked FROM transactions WHERE external_id = 'sf-posted-1'`;
    expect(post.category_id).toBe(restaurants);
    expect(post.category_locked).toBe(true);

    // And the pending row no longer counts toward spending.
    const [v] = await sql<{ counts_as_spending: boolean }[]>`
      SELECT counts_as_spending FROM v_transactions WHERE external_id = 'sf-pending-1'`;
    expect(v.counts_as_spending).toBe(false);
  });

  it('does not supersede a row outside the date or amount window', async () => {
    const pending: CanonicalTxn = {
      accountId: acct.checkingId,
      amountCents: -2000,
      postedDate: '2026-09-01',
      status: 'pending',
      rawDescription: 'FAR AWAY MERCHANT',
      source: 'simplefin',
      externalId: 'sf-pending-far',
    };
    await upsertTransactions(sql, [pending]);

    // 20 days later and double the amount — a different transaction.
    const r = await upsertTransactions(sql, [{
      ...pending, amountCents: -4000, postedDate: '2026-09-21',
      status: 'posted', externalId: 'sf-posted-far',
    }]);
    expect(r.superseded).toBe(0);

    const [p] = await sql<{ superseded_by_id: string | null }[]>`
      SELECT superseded_by_id FROM transactions WHERE external_id = 'sf-pending-far'`;
    expect(p.superseded_by_id).toBeNull();
  });
});

describe('I2 — raw source values are immutable', () => {
  it('leaves amount_cents untouched when an override is set', async () => {
    const [row] = await sql<{ id: string; amount_cents: number }[]>`
      SELECT id, amount_cents FROM transactions
      WHERE account_id = ${acct.appleId} AND amount_cents = -8712 LIMIT 1`;

    await sql`UPDATE transactions SET amount_cents_override = -8000 WHERE id = ${row.id}`;

    const [after] = await sql<{ amount_cents: number; eff_amount_cents: number; is_amount_or_date_edited: boolean }[]>`
      SELECT amount_cents, eff_amount_cents, is_amount_or_date_edited
      FROM v_transactions WHERE id = ${row.id}`;

    expect(after.amount_cents).toBe(-8712);       // raw, for reconciliation
    expect(after.eff_amount_cents).toBe(-8000);   // what reporting reads
    expect(after.is_amount_or_date_edited).toBe(true);

    await sql`UPDATE transactions SET amount_cents_override = NULL WHERE id = ${row.id}`;
  });
});
