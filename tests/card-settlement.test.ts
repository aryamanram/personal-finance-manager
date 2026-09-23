/**
 * A credit card's purchases are only a safe record of spending while the card
 * is being paid off.
 *
 * This ledger counts the purchase, not the payment that settles it: the
 * payment carries necessity 'transfer', so counts_as_spending is false and a
 * $60 dinner is not also $60 of "Credit Card Payment". That is correct exactly
 * as long as no balance is being carried — a carried balance means purchases
 * claim money that never left the bank.
 *
 * The identity that rules it out:
 *
 *     purchases − paid_off = still_owed = what the issuer reports
 *
 * So these tests assert arithmetic against a card built to a known answer, and
 * check both directions: a settled card reports a zero gap, and a card missing
 * a purchase, or quietly accruing interest, does not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb } from './helpers/db';
import { fingerprint } from '@/ingest/fingerprint';

let sql: Sql;
let drop: () => Promise<void>;
let getCardSettlement: typeof import('@/lib/queries').getCardSettlement;

/** Cents owed on each card, as the issuer reports it (negative = owed). */
const SETTLED_BALANCE = -70721;   // $707.21 outstanding
const CARRIED_BALANCE = -80000;   // more owed than the ledger can explain

let transferId: string;
let groceriesId: string;
let institutionId: string;

beforeAll(async () => {
  const db = await createTestDb('cardsettlement');
  sql = db.sql;
  drop = db.drop;

  // queries.ts builds its pool from DATABASE_URL at import time, so the env
  // has to point at the scratch database before the dynamic import.
  process.env.DATABASE_URL = db.url;
  ({ getCardSettlement } = await import('@/lib/queries'));

  const [inst] = await sql<{ id: string }[]>`
    INSERT INTO institutions (name, source) VALUES ('Test Bank', 'simplefin') RETURNING id`;
  institutionId = inst.id;

  // A category per necessity, so the view's counts_as_spending predicate is
  // driven by real data rather than by a column set by hand.
  [{ id: transferId }] = await sql<{ id: string }[]>`
    SELECT id FROM categories WHERE default_necessity = 'transfer' LIMIT 1`;
  [{ id: groceriesId }] = await sql<{ id: string }[]>`
    SELECT id FROM categories WHERE default_necessity IN ('required','discretionary') LIMIT 1`;

  // Both cards charge the same $707.21. They differ only in what the issuer
  // reports, which is the whole point of the comparison.
  await card(inst.id, 'Settled Card', SETTLED_BALANCE, [-40000, -30721]);
  await card(inst.id, 'Carried Card', CARRIED_BALANCE, [-40000, -30721]);
});

afterAll(async () => { await drop(); });

/** Builds a credit account carrying the given purchases (negative cents). */
async function card(
  institutionId: string,
  name: string,
  balanceCents: number,
  purchases: number[],
) {
  const [a] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, external_id, balance_cents)
    VALUES (${institutionId}, ${name}, 'credit', 'simplefin',
            ${name.toLowerCase().replace(/\s+/g, '-')}, ${balanceCents})
    RETURNING id`;
  let i = 0;
  for (const amountCents of purchases) {
    i += 1;
    await insert(a.id, {
      description: `MERCHANT ${i}`,
      amountCents,
      postedDate: `2026-09-${String(i).padStart(2, '0')}`,
      categoryId: groceriesId,
    });
  }
  return a.id;
}

/** Writes one row, fingerprinted the way the real ingest path does (I7). */
async function insert(
  accountId: string,
  row: {
    description: string; amountCents: number; postedDate: string;
    categoryId: string; status?: 'posted' | 'pending';
  },
) {
  await sql`
    INSERT INTO transactions
      (account_id, raw_description, amount_cents, posted_date, status, source,
       fingerprint, category_id, category_source)
    VALUES (${accountId}, ${row.description}, ${row.amountCents}, ${row.postedDate},
            ${row.status ?? 'posted'}, 'simplefin',
            ${fingerprint({
              accountId,
              postedDate: row.postedDate,
              amountCents: row.amountCents,
              rawDescription: row.description,
            })},
            ${row.categoryId}, 'rule')`;
}

/** Adds one payment to a card, the way settling a balance actually looks. */
async function pay(
  name: string,
  amountCents: number,
  postedDate = '2026-09-20',
  status: 'posted' | 'pending' = 'posted',
) {
  const [a] = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE name = ${name}`;
  await insert(a.id, {
    description: 'PAYMENT THANK YOU',
    amountCents,
    postedDate,
    categoryId: transferId,
    status,
  });
}

const find = (rows: Awaited<ReturnType<typeof getCardSettlement>>, name: string) => {
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`No settlement row for ${name}`);
  return row;
};

describe('a card with nothing paid off yet', () => {
  it('owes every cent it has charged, and the issuer agrees', async () => {
    const row = find(await getCardSettlement(), 'Settled Card');
    expect(row.purchases_cents).toBe(70721);
    expect(row.paid_cents).toBe(0);
    expect(row.clearing_cents).toBe(0);
    expect(row.owed_cents).toBe(70721);
    expect(row.bank_owed_cents).toBe(70721);
    expect(row.gap_cents).toBe(0);
  });
});

describe('a card being paid down', () => {
  it('moves purchases out of "owed" as they are settled, cent for cent', async () => {
    await pay('Settled Card', 49183);
    await sql`UPDATE accounts SET balance_cents = ${-(70721 - 49183)}
              WHERE name = 'Settled Card'`;

    const row = find(await getCardSettlement(), 'Settled Card');
    expect(row.purchases_cents).toBe(70721);   // purchases never move
    expect(row.paid_cents).toBe(49183);
    expect(row.owed_cents).toBe(21538);
    expect(row.bank_owed_cents).toBe(21538);
    expect(row.gap_cents).toBe(0);
  });

  it('reaches zero owed when the card is paid off in full', async () => {
    await pay('Settled Card', 21538, '2026-09-25');
    await sql`UPDATE accounts SET balance_cents = 0 WHERE name = 'Settled Card'`;

    const row = find(await getCardSettlement(), 'Settled Card');
    expect(row.paid_cents).toBe(70721);
    expect(row.owed_cents).toBe(0);
    expect(row.gap_cents).toBe(0);
  });
});

describe('a payment the issuer has not applied yet', () => {
  it('leaves the balance alone and reports the money as clearing', async () => {
    // The real case this was written for: a card paid off in full, still
    // pending two days later. Counting it as paid made the ledger claim a
    // zero balance while the issuer still wanted the full amount — a phantom
    // gap, the size of the payment, on a card that was reconciling exactly.
    await card(institutionId, 'Clearing Card', -460990, [-460990]);
    await pay('Clearing Card', 460990, '2026-09-21', 'pending');

    const row = find(await getCardSettlement(), 'Clearing Card');
    expect(row.purchases_cents).toBe(460990);
    expect(row.paid_cents).toBe(0);           // not applied, so not paid
    expect(row.clearing_cents).toBe(460990);  // but not missing either
    expect(row.owed_cents).toBe(460990);
    expect(row.bank_owed_cents).toBe(460990);
    expect(row.gap_cents).toBe(0);            // the card reconciles
  });

  it('moves it into paid once the issuer applies it', async () => {
    await sql`UPDATE transactions SET status = 'posted'
              WHERE raw_description = 'PAYMENT THANK YOU' AND amount_cents = 460990`;
    await sql`UPDATE accounts SET balance_cents = 0 WHERE name = 'Clearing Card'`;

    const row = find(await getCardSettlement(), 'Clearing Card');
    expect(row.paid_cents).toBe(460990);
    expect(row.clearing_cents).toBe(0);
    expect(row.owed_cents).toBe(0);
    expect(row.gap_cents).toBe(0);
  });
});

describe('the cases the identity exists to catch', () => {
  it('reports a gap when the issuer says more is owed than the ledger explains', async () => {
    // Interest, a fee, or a purchase the feed never delivered: the ledger
    // accounts for $707.21 of charges, the issuer wants $800.
    const row = find(await getCardSettlement(), 'Carried Card');
    expect(row.owed_cents).toBe(70721);
    expect(row.bank_owed_cents).toBe(80000);
    expect(row.gap_cents).toBe(9279);
  });

  it('reports a gap when a payment is recorded that the issuer never saw', async () => {
    await pay('Carried Card', 10000);
    const row = find(await getCardSettlement(), 'Carried Card');
    expect(row.paid_cents).toBe(10000);
    expect(row.owed_cents).toBe(60721);
    expect(row.bank_owed_cents).toBe(80000);
    expect(row.gap_cents).toBe(19279);
  });
});

describe('what the identity protects', () => {
  it('excludes the settling payments from spending, so a purchase is counted once', async () => {
    // The actual double-counting check: if payments counted as spending, a
    // card would report its purchases AND the money used to settle them.
    const [{ spend }] = await sql<{ spend: number }[]>`
      SELECT COALESCE(-SUM(eff_amount_cents) FILTER (WHERE counts_as_spending), 0)::int AS spend
      FROM v_transactions v
      JOIN accounts a ON a.id = v.account_id
      WHERE a.name = 'Settled Card'`;
    expect(spend).toBe(70721);   // the purchases, and nothing else
  });

  it('counts no payment row as spending on any card', async () => {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM v_transactions v
      JOIN accounts a ON a.id = v.account_id
      WHERE a.type = 'credit' AND v.counts_as_spending
        AND v.raw_description = 'PAYMENT THANK YOU'`;
    expect(n).toBe(0);
  });
});
