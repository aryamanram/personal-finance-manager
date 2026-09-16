/**
 * M5 acceptance: a checking->Explorer payment pair is linked and
 * counts_as_spending = false on both legs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb, seedAccounts, categoryByName } from './helpers/db';
import { upsertTransactions } from '@/ingest/upsert';
import { matchTransfers, scorePair, linkPair, unlinkTransfer, TransferLinkError } from '@/transfers/match';
import type { CanonicalTxn } from '@/lib/types';

let sql: Sql;
let drop: () => Promise<void>;
let acct: Awaited<ReturnType<typeof seedAccounts>>;

const txn = (
  o: Partial<CanonicalTxn> & { accountId: string; rawDescription: string; amountCents: number; postedDate: string },
): CanonicalTxn => ({ status: 'posted', source: 'csv', externalId: null, ...o });

beforeAll(async () => {
  const db = await createTestDb('transfers');
  sql = db.sql;
  drop = db.drop;
  acct = await seedAccounts(sql);
}, 30_000);

afterAll(async () => { await drop(); });

describe('scoring', () => {
  it('rates a same-day pair with transfer language on both legs as certain', () => {
    expect(scorePair({
      dayGap: 0, windowDays: 5, sameInstitution: true,
      aDescription: 'CHASE CREDIT CRD AUTOPAY', bDescription: 'AUTOMATIC PAYMENT - THANK YOU',
    })).toBeGreaterThanOrEqual(0.9);
  });

  it('rates an equal-and-opposite coincidence with no transfer language low', () => {
    expect(scorePair({
      dayGap: 4, windowDays: 5, sameInstitution: false,
      aDescription: 'WHOLE FOODS MKT', bDescription: 'REFUND WHOLE FOODS',
    })).toBeLessThan(0.9);
  });

  it('decays with date distance', () => {
    const near = scorePair({ dayGap: 1, windowDays: 45, sameInstitution: false, aDescription: 'PAYMENT', bDescription: 'PAYMENT' });
    const far  = scorePair({ dayGap: 30, windowDays: 45, sameInstitution: false, aDescription: 'PAYMENT', bDescription: 'PAYMENT' });
    expect(near).toBeGreaterThan(far);
  });
});

describe('M5 — checking -> Explorer payment', () => {
  it('links the pair and excludes both legs from spending', async () => {
    await upsertTransactions(sql, [
      txn({ accountId: acct.checkingId, rawDescription: 'CHASE CREDIT CRD AUTOPAY 9911', amountCents: -128745, postedDate: '2026-08-18' }),
      txn({ accountId: acct.explorerId, rawDescription: 'AUTOMATIC PAYMENT - THANK YOU', amountCents: 128745, postedDate: '2026-08-18' }),
    ]);

    const r = await matchTransfers(sql);
    expect(r.linked).toBe(1);

    const legs = await sql<{ transfer_id: string; counts_as_spending: boolean }[]>`
      SELECT transfer_id, counts_as_spending FROM v_transactions
      WHERE abs(eff_amount_cents) = 128745`;

    expect(legs).toHaveLength(2);
    expect(legs[0].transfer_id).toBe(legs[1].transfer_id);
    expect(legs.every((l) => l.counts_as_spending === false)).toBe(true);
  });

  it('is idempotent — a second pass links nothing new', async () => {
    const r = await matchTransfers(sql);
    expect(r.linked).toBe(0);
    const [{ c }] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM transfers`;
    expect(c).toBe(1);
  });
});

describe('the Apple Card case — legs arriving weeks apart', () => {
  it('links across a wide window because the CSV account syncs monthly', async () => {
    await upsertTransactions(sql, [
      txn({ accountId: acct.checkingId, rawDescription: 'ACH PAYMENT APPLE CARD GS BANK', amountCents: -45000, postedDate: '2026-07-05', source: 'simplefin', externalId: 'sf-ac-pay' }),
      // The Apple Card CSV lands three weeks later.
      txn({ accountId: acct.appleId, rawDescription: 'ACH Deposit Internet Transfer', amountCents: 45000, postedDate: '2026-07-26' }),
    ]);

    const r = await matchTransfers(sql);
    const linkedOrQueued = r.linked + r.candidates.filter((c) => Math.abs(c.amountCents) === 45000).length;
    expect(linkedOrQueued).toBeGreaterThan(0);

    // 21 days apart is beyond the 5-day default; it must still be a candidate.
    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM v_transactions WHERE abs(eff_amount_cents) = 45000`;
    expect(c).toBe(2);
  });
});

describe('ambiguity is queued, not guessed', () => {
  it('returns a low-confidence pair as a candidate instead of linking it', async () => {
    await upsertTransactions(sql, [
      txn({ accountId: acct.checkingId, rawDescription: 'SOME VENDOR CHARGE', amountCents: -2500, postedDate: '2026-09-02' }),
      txn({ accountId: acct.explorerId, rawDescription: 'REFUND SOME VENDOR', amountCents: 2500, postedDate: '2026-09-05' }),
    ]);

    const r = await matchTransfers(sql);
    const candidate = r.candidates.find((c) => Math.abs(c.amountCents) === 2500);
    expect(candidate).toBeDefined();
    expect(candidate!.confidence).toBeLessThan(0.9);

    // Nothing was linked, so both still count as spending.
    const rows = await sql<{ transfer_id: string | null }[]>`
      SELECT transfer_id FROM transactions WHERE abs(amount_cents) = 2500`;
    expect(rows.every((x) => x.transfer_id === null)).toBe(true);
  });

  it('a one-click manual confirm links it and records matched_by = manual', async () => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM transactions WHERE abs(amount_cents) = 2500 ORDER BY amount_cents`;
    const transferId = await linkPair(sql, rows[0].id, rows[1].id, 'manual');

    const [t] = await sql<{ matched_by: string; confidence: string | null }[]>`
      SELECT matched_by, confidence FROM transfers WHERE id = ${transferId}`;
    expect(t.matched_by).toBe('manual');
    expect(t.confidence).toBeNull();

    const legs = await sql<{ counts_as_spending: boolean }[]>`
      SELECT counts_as_spending FROM v_transactions WHERE transfer_id = ${transferId}`;
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => !l.counts_as_spending)).toBe(true);
  });

  it('unlinking restores both legs to the ledger', async () => {
    const [t] = await sql<{ id: string }[]>`SELECT id FROM transfers WHERE matched_by = 'manual'`;
    await unlinkTransfer(sql, t.id);

    const rows = await sql<{ transfer_id: string | null }[]>`
      SELECT transfer_id FROM transactions WHERE abs(amount_cents) = 2500`;
    expect(rows.every((x) => x.transfer_id === null)).toBe(true);
  });
});

describe('a manual link is validated, not trusted', () => {
  // The auto matcher only passes pairs its own query vetted, but --link and the
  // UI take two ids from a human. A transfer's legs are excluded from spending,
  // so a bad link silently removes real money from the totals.
  it('refuses an id that does not exist', async () => {
    const [real] = await sql<{ id: string }[]>`SELECT id FROM transactions LIMIT 1`;
    await expect(
      linkPair(sql, real.id, '00000000-0000-0000-0000-000000000000', 'manual'),
    ).rejects.toThrow(TransferLinkError);
  });

  it('refuses to link a transaction to itself', async () => {
    const [real] = await sql<{ id: string }[]>`SELECT id FROM transactions LIMIT 1`;
    await expect(linkPair(sql, real.id, real.id, 'manual')).rejects.toThrow(/two different/i);
  });

  it('refuses to steal a leg out of an existing transfer', async () => {
    const [linked] = await sql<{ id: string }[]>`
      SELECT id FROM transactions WHERE transfer_id IS NOT NULL LIMIT 1`;
    const [free] = await sql<{ id: string }[]>`
      SELECT id FROM transactions WHERE transfer_id IS NULL LIMIT 1`;
    await expect(linkPair(sql, linked.id, free.id, 'manual')).rejects.toThrow(/already part of/i);
  });

  it('refuses two legs on the same account', async () => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM transactions
      WHERE transfer_id IS NULL AND account_id = ${acct.appleId} LIMIT 2`;
    if (rows.length === 2) {
      await expect(linkPair(sql, rows[0].id, rows[1].id, 'manual'))
        .rejects.toThrow(/same account/i);
    }
  });

  it('leaves no orphaned transfer row behind when it refuses', async () => {
    const [{ before }] = await sql<{ before: number }[]>`
      SELECT count(*)::int AS before FROM transfers`;
    const [real] = await sql<{ id: string }[]>`SELECT id FROM transactions LIMIT 1`;
    await expect(
      linkPair(sql, real.id, '00000000-0000-0000-0000-000000000000', 'manual'),
    ).rejects.toThrow();
    const [{ after }] = await sql<{ after: number }[]>`
      SELECT count(*)::int AS after FROM transfers`;
    expect(after).toBe(before);
  });
});

describe('pair enumeration does not depend on UUID ordering', () => {
  it('finds the pair regardless of which leg has the higher id', async () => {
    // Regression: the candidate join once carried BOTH `a.id < b.id` and
    // `a.eff_amount_cents < 0`. Those orderings are independent, so any pair
    // whose outflow row sorted after its inflow row was silently dropped —
    // roughly half of all transfers, with no error.
    let found = 0;
    for (let i = 0; i < 12; i++) {
      const amount = 70000 + i;
      const day = String(10 + i).padStart(2, '0');
      await upsertTransactions(sql, [
        txn({ accountId: acct.checkingId, rawDescription: 'ONLINE TRANSFER TO SAVINGS', amountCents: -amount, postedDate: `2026-10-${day}` }),
        txn({ accountId: acct.explorerId, rawDescription: 'PAYMENT THANK YOU',           amountCents:  amount, postedDate: `2026-10-${day}` }),
      ]);
      await matchTransfers(sql);

      const [{ c }] = await sql<{ c: number }[]>`
        SELECT count(*)::int AS c FROM transactions
        WHERE abs(amount_cents) = ${amount} AND transfer_id IS NOT NULL`;
      if (c === 2) found++;
    }
    // Every one of the 12 must link. Under the old bug this averaged ~6.
    expect(found).toBe(12);
  });
});

describe('a transaction can only be one leg of one transfer', () => {
  it('does not link the same row into two pairs', async () => {
    // One outflow, two equal-and-opposite inflows on different accounts.
    await upsertTransactions(sql, [
      txn({ accountId: acct.checkingId, rawDescription: 'TRANSFER OUT', amountCents: -10000, postedDate: '2026-09-10' }),
      txn({ accountId: acct.explorerId, rawDescription: 'PAYMENT THANK YOU', amountCents: 10000, postedDate: '2026-09-10' }),
      txn({ accountId: acct.appleId,    rawDescription: 'PAYMENT THANK YOU', amountCents: 10000, postedDate: '2026-09-10' }),
    ]);

    await matchTransfers(sql);

    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM transactions
      WHERE amount_cents = -10000 AND transfer_id IS NOT NULL`;
    expect(c).toBe(1);

    // Exactly two legs on that transfer, not three.
    const [{ legs }] = await sql<{ legs: number }[]>`
      SELECT count(*)::int AS legs FROM transactions
      WHERE transfer_id = (SELECT transfer_id FROM transactions WHERE amount_cents = -10000 AND transfer_id IS NOT NULL)`;
    expect(legs).toBe(2);
  });
});
