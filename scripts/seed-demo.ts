/**
 * Synthetic 6-month dataset (DESIGN.md §11). Develop the UI against this, never
 * against real financial data.
 *
 * Includes every case the UI has to render correctly:
 *   - payroll, rent, card payment transfer pairs
 *   - a duplicate needing voiding
 *   - a pending -> posted pair
 *   - a manually overridden category
 *   - investment contributions + balance snapshots
 */
import postgres from 'postgres';
import { loadEnv } from './env.js';
import { pgTypes } from '../src/lib/pg-types.js';
import { upsertTransactions } from '../src/ingest/upsert.js';
import { runCategorization } from '../src/categorize/run.js';
import { matchTransfers } from '../src/transfers/match.js';
import type { CanonicalTxn } from '../src/lib/types.js';

loadEnv();

const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {}, types: pgTypes });

const MONTHS = 6;
const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Deterministic PRNG so a reseed produces the same ledger. */
let seed = 42;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const vary = (cents: number, pct = 0.25) =>
  Math.round(cents * (1 + (rand() - 0.5) * 2 * pct));

async function main() {
  console.log('· clearing existing data');
  await sql`TRUNCATE transactions, transfers, import_batches, sync_runs,
            balance_snapshots, holdings, merchants, rules, recurring_series,
            accounts, institutions RESTART IDENTITY CASCADE`;

  console.log('· accounts');
  const [chase] = await sql<{ id: string }[]>`
    INSERT INTO institutions (name, source) VALUES ('Chase', 'simplefin') RETURNING id`;
  const [gs] = await sql<{ id: string }[]>`
    INSERT INTO institutions (name, source) VALUES ('Goldman Sachs', 'csv') RETURNING id`;
  const [ms] = await sql<{ id: string }[]>`
    INSERT INTO institutions (name, source) VALUES ('Morgan Stanley', 'manual') RETURNING id`;

  const [checking] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, external_id, mask)
    VALUES (${chase.id}, 'Chase Total Checking', 'depository', 'simplefin', 'demo-chk', '4432')
    RETURNING id`;
  const [explorer] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, external_id, mask)
    VALUES (${chase.id}, 'Chase United Explorer', 'credit', 'simplefin', 'demo-exp', '9911')
    RETURNING id`;
  const [apple] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, mask)
    VALUES (${gs.id}, 'Apple Card', 'credit', 'csv', '0007')
    RETURNING id`;
  const [brokerage] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, mask)
    VALUES (${ms.id}, 'Morgan Stanley Brokerage', 'investment', 'manual', '1234')
    RETURNING id`;

  const txns: CanonicalTxn[] = [];
  const add = (t: Partial<CanonicalTxn> & Pick<CanonicalTxn, 'accountId' | 'amountCents' | 'postedDate' | 'rawDescription'>) =>
    txns.push({ status: 'posted', source: 'simplefin', externalId: null, ...t });

  let extId = 0;
  const sf = () => `demo-sf-${++extId}`;

  const groceries = ['TRADER JOES #447', 'WHOLE FOODS MKT 10234', 'SAFEWAY 2891'];
  const restaurants = ['THE LOCAL BISTRO', 'SQ *TACO HAUS', 'TST* NOODLE BAR', 'CHIPOTLE 1882'];
  const coffee = ['STARBUCKS #12345', 'SQ *BLUE BOTTLE COFFEE', 'PEETS COFFEE 331'];
  const shopping = ['AMAZON.COM*RT4X9', 'TARGET 00023877', 'UNIQLO USA 4412'];
  const gas = ['SHELL OIL 574123', 'CHEVRON 00982341'];

  console.log(`· generating ${MONTHS} months of transactions`);

  for (let m = MONTHS - 1; m >= 0; m--) {
    const month = new Date(today.getFullYear(), today.getMonth() - m, 1);
    const y = month.getFullYear();
    const mo = month.getMonth();
    const day = (d: number) => iso(new Date(y, mo, d));

    // --- Income: semi-monthly payroll ------------------------------------
    for (const d of [15, 30]) {
      add({ accountId: checking.id, amountCents: 540000, postedDate: day(d),
            rawDescription: 'ACME CORP PAYROLL DIRECT DEP', externalId: sf() });
    }

    // --- Fixed required --------------------------------------------------
    add({ accountId: checking.id, amountCents: -285000, postedDate: day(1),
          rawDescription: 'GREYSTAR RENT PAYMENT ONLINE', externalId: sf() });
    add({ accountId: checking.id, amountCents: -8500, postedDate: day(4),
          rawDescription: 'STATE FARM RENTERS INS', externalId: sf() });
    add({ accountId: checking.id, amountCents: -7000, postedDate: day(6),
          rawDescription: 'VERIZON WIRELESS PAYMENT', externalId: sf() });
    add({ accountId: checking.id, amountCents: vary(-9500, 0.3), postedDate: day(9),
          rawDescription: 'CITY UTILITIES AUTOPAY', externalId: sf() });

    // --- Fixed discretionary (subscriptions on the Apple Card) -----------
    add({ accountId: apple.id, amountCents: -1599, postedDate: day(7),
          rawDescription: 'NETFLIX.COM', source: 'csv' });
    add({ accountId: apple.id, amountCents: -1099, postedDate: day(12),
          rawDescription: 'SPOTIFY USA', source: 'csv' });
    add({ accountId: apple.id, amountCents: -299, postedDate: day(3),
          rawDescription: 'APPLE.COM/BILL', source: 'csv' });
    add({ accountId: checking.id, amountCents: -4500, postedDate: day(2),
          rawDescription: 'EQUINOX FITNESS MONTHLY', externalId: sf() });

    // --- Variable required ----------------------------------------------
    for (let i = 0; i < 4; i++) {
      add({ accountId: explorer.id, amountCents: vary(-11200), postedDate: day(3 + i * 7),
            rawDescription: pick(groceries), externalId: sf() });
    }
    for (let i = 0; i < 2; i++) {
      add({ accountId: explorer.id, amountCents: vary(-5400), postedDate: day(8 + i * 12),
            rawDescription: pick(gas), externalId: sf() });
    }

    // --- Variable discretionary -----------------------------------------
    for (let i = 0; i < 7; i++) {
      add({ accountId: explorer.id, amountCents: vary(-4200), postedDate: day(2 + i * 4),
            rawDescription: pick(restaurants), externalId: sf() });
    }
    for (let i = 0; i < 6; i++) {
      add({ accountId: apple.id, amountCents: vary(-575, 0.4), postedDate: day(2 + i * 5),
            rawDescription: pick(coffee), source: 'csv' });
    }
    for (let i = 0; i < 3; i++) {
      add({ accountId: apple.id, amountCents: vary(-6800, 0.6), postedDate: day(5 + i * 9),
            rawDescription: pick(shopping), source: 'csv' });
    }

    // Apple Card Daily Cash: a credit, and it must never read as income.
    add({ accountId: apple.id, amountCents: vary(229, 0.3), postedDate: day(18),
          rawDescription: 'Daily Cash Adjustment', source: 'csv' });

    // --- Investment contribution ----------------------------------------
    add({ accountId: checking.id, amountCents: -200000, postedDate: day(16),
          rawDescription: 'MORGAN STANLEY ACH TRANSFER', externalId: sf() });

    // --- Transfer pairs: checking -> each card --------------------------
    add({ accountId: checking.id, amountCents: -128745, postedDate: day(18),
          rawDescription: 'CHASE CREDIT CRD AUTOPAY 9911', externalId: sf() });
    add({ accountId: explorer.id, amountCents: 128745, postedDate: day(18),
          rawDescription: 'AUTOMATIC PAYMENT - THANK YOU', externalId: sf() });

    add({ accountId: checking.id, amountCents: -38715, postedDate: day(22),
          rawDescription: 'ACH PAYMENT APPLE CARD GSBANK', externalId: sf() });
    add({ accountId: apple.id, amountCents: 38715, postedDate: day(24),
          rawDescription: 'ACH Deposit Internet Transfer from account ending in 4432',
          source: 'csv' });
  }

  // --- The Explorer's annual fee: one lumpy fixed charge (DESIGN §12) ----
  const feeMonth = new Date(today.getFullYear(), today.getMonth() - 3, 14);
  add({ accountId: explorer.id, amountCents: -9500, postedDate: iso(feeMonth),
        rawDescription: 'UNITED EXPLORER ANNUAL MEMBERSHIP FEE', externalId: sf() });

  // --- A pending transaction that has not posted yet --------------------
  const pendingDate = new Date(today); pendingDate.setDate(today.getDate() - 1);
  add({ accountId: explorer.id, amountCents: -6400, postedDate: iso(pendingDate),
        rawDescription: 'THE LOCAL BISTRO', status: 'pending', externalId: sf() });

  console.log(`· inserting ${txns.length} transactions`);
  const up = await upsertTransactions(sql, txns);
  console.log(`  ${up.inserted} inserted, ${up.duplicate} deduped`);

  // --- A duplicate that needs voiding (I5: voided, never deleted) -------
  const dupDate = new Date(today.getFullYear(), today.getMonth() - 1, 11);
  const [dup] = await sql<{ id: string }[]>`
    INSERT INTO transactions (account_id, amount_cents, posted_date, raw_description,
                              source, fingerprint, status, external_id)
    VALUES (${explorer.id}, -11200, ${iso(dupDate)}, 'WHOLE FOODS MKT 10234',
            'simplefin', ${'demo-dup-fingerprint'}, 'posted', 'demo-dup-1')
    RETURNING id`;
  await sql`
    UPDATE transactions
    SET voided_at = now(), void_reason = 'Duplicate — bank posted this twice'
    WHERE id = ${dup.id}`;

  console.log('· rules');
  const cat = async (name: string) =>
    (await sql<{ id: string }[]>`SELECT id FROM categories WHERE name = ${name}`)[0].id;

  await sql`INSERT INTO rules (name, priority, match_regex, set_category_id) VALUES
    ('Payroll',        10, 'PAYROLL|DIRECT DEP',            ${await cat('Paycheck')}),
    ('Rent',           20, 'GREYSTAR|RENT PAYMENT',         ${await cat('Rent')}),
    ('Renters ins',    25, 'RENTERS INS',                   ${await cat('Renters Insurance')}),
    ('Phone',          25, 'VERIZON|T-MOBILE|AT&T',         ${await cat('Internet & Phone')}),
    ('Utilities',       5, 'UTILITIES|ELECTRIC|PG&E|WATER DEPT', ${await cat('Utilities')}),
    ('Gym',            30, 'EQUINOX|PLANET FITNESS',        ${await cat('Fitness')}),
    ('Subscriptions',  30, 'NETFLIX|SPOTIFY|APPLE.COM',     ${await cat('Subscriptions')}),
    ('Groceries',      40, 'TRADER JOE|WHOLE FOODS|SAFEWAY',${await cat('Groceries')}),
    ('Gas',            40, 'SHELL|CHEVRON|EXXON',           ${await cat('Gas')}),
    ('Coffee',         45, 'STARBUCKS|BLUE BOTTLE|PEETS',   ${await cat('Coffee')}),
    ('Restaurants',    50, 'BISTRO|TACO|NOODLE|CHIPOTLE',   ${await cat('Restaurants')}),
    ('Shopping',       55, 'AMAZON|TARGET|UNIQLO',          ${await cat('Shopping')}),
    ('Annual fee',     35, 'ANNUAL MEMBERSHIP FEE',         ${await cat('Fees & Interest')}),
    ('Daily Cash',     15, 'Daily Cash',                    ${await cat('Reimbursement')}),
    -- Deliberately NARROW. A broad 'AUTOPAY' here would swallow 'CITY UTILITIES
    -- AUTOPAY', and because Credit Card Payment carries necessity='transfer',
    -- that bill would drop out of spending entirely rather than merely landing
    -- in the wrong bucket. Transfer-ish rules must name the card.
    ('Card payment',   10, 'CREDIT CRD AUTOPAY|AUTOMATIC PAYMENT - THANK YOU|ACH PAYMENT APPLE CARD|Internet Transfer from account',
                                                            ${await cat('Credit Card Payment')}),
    ('Brokerage',      10, 'MORGAN STANLEY',                ${await cat('Brokerage Contribution')})`;

  console.log('· categorizing');
  const report = await runCategorization(sql, { noLlm: true });
  console.log(`  ${report.byRule} by rule, ${report.toUncategorized} to Uncategorized`);

  // Daily Cash must net against spending, not inflate income (DESIGN §6.2).
  await sql`
    UPDATE transactions SET necessity_override = 'discretionary'
    WHERE raw_description ILIKE '%daily cash%'`;

  console.log('· linking investment contributions');
  await sql`
    UPDATE transactions SET destination_account_id = ${brokerage.id}
    WHERE raw_description ILIKE '%MORGAN STANLEY%' AND amount_cents < 0`;

  console.log('· matching transfers');
  const tr = await matchTransfers(sql);
  console.log(`  ${tr.linked} linked, ${tr.candidates.length} queued for review`);

  // --- A manual override, so the UI has an edited row to render ---------
  const [manual] = await sql<{ id: string }[]>`
    SELECT id FROM transactions
    WHERE raw_description LIKE 'STARBUCKS%' AND voided_at IS NULL
    ORDER BY posted_date DESC LIMIT 1`;
  if (manual) {
    const gifts = await cat('Gifts');
    await sql`
      UPDATE transactions
      SET category_id = ${gifts}, category_source = 'manual',
          description = 'Coffee for the team', notes = 'Reimbursable?'
      WHERE id = ${manual.id}`;
    await sql`
      INSERT INTO transaction_edits (transaction_id, field, old_value, new_value)
      VALUES (${manual.id}, 'category_id', 'Coffee', 'Gifts'),
             (${manual.id}, 'description', NULL, 'Coffee for the team')`;
  }

  // --- An amount override, to exercise the edited-value marker ----------
  const [edited] = await sql<{ id: string }[]>`
    SELECT id FROM transactions WHERE raw_description LIKE 'AMAZON%'
    ORDER BY posted_date DESC LIMIT 1`;
  if (edited) {
    await sql`
      UPDATE transactions SET amount_cents_override = -2500 WHERE id = ${edited.id}`;
    await sql`
      INSERT INTO transaction_edits (transaction_id, field, old_value, new_value)
      VALUES (${edited.id}, 'amount_cents', '-6800', '-2500')`;
  }

  // --- Brokerage snapshots: value moves with the market, never the ledger
  console.log('· brokerage snapshots');
  let value = 8_000_000;   // $80,000 opening position, predating tracking
  for (let m = MONTHS; m >= 0; m--) {
    const d = new Date(today.getFullYear(), today.getMonth() - m + 1, 0);
    if (m < MONTHS) value += 200000;                    // the contribution
    value = Math.round(value * (1 + (rand() - 0.42) * 0.04));  // market drift
    await sql`
      INSERT INTO balance_snapshots (account_id, as_of, balance_cents, source)
      VALUES (${brokerage.id}, ${iso(d)}, ${value}, 'manual')
      ON CONFLICT (account_id, as_of) DO UPDATE SET balance_cents = EXCLUDED.balance_cents`;
  }

  // Balances are what the bank reports. Derive them from the ledger so the
  // demo reconciles — then introduce ONE deliberate discrepancy, because a
  // reconciliation banner that never fires is untested UI.
  console.log('· reconciling account balances');
  await sql`
    UPDATE accounts a SET balance_cents = led.total, balance_as_of = now()
    FROM (
      SELECT account_id, COALESCE(SUM(amount_cents), 0)::bigint AS total
      FROM transactions WHERE voided_at IS NULL AND superseded_by_id IS NULL
      GROUP BY account_id
    ) led
    WHERE a.id = led.account_id AND a.type <> 'investment'`;

  // A $12.40 fee the bank applied but has not yet sent a transaction for.
  await sql`
    UPDATE accounts SET balance_cents = balance_cents - 1240 WHERE id = ${explorer.id}`;

  const cashflow = await sql`
    SELECT month, income_cents, required_cents, discretionary_cents, invested_cents
    FROM v_monthly_cashflow ORDER BY month DESC LIMIT 3`;
  console.log('\n· recent months:');
  for (const r of cashflow) {
    console.log(`  ${r.month}  income ${fmt(r.income_cents)}  required ${fmt(r.required_cents)}` +
                `  discretionary ${fmt(r.discretionary_cents)}  invested ${fmt(r.invested_cents)}`);
  }

  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM transactions`;
  console.log(`\n✓ seeded ${n} transactions`);
}

const fmt = (c: number | null) =>
  c === null ? '—' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => sql.end());
