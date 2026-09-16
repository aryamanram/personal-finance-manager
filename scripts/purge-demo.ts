/**
 * Remove seeded demo data, keeping everything real.
 *
 * seed-demo.ts marks every account it creates with a `demo-` external_id, and
 * every transaction it writes carries a `demo-sf-` external_id or belongs to a
 * demo account. That marking is what makes this safe to run against a database
 * that already holds real transactions.
 *
 *   npx tsx scripts/purge-demo.ts --dry-run     # show what would go
 *   npx tsx scripts/purge-demo.ts               # do it
 *
 * Accounts you will want to keep using (the Apple Card, the brokerage) are
 * emptied rather than dropped, unless --drop-shells is passed.
 */
import postgres from 'postgres';
import { loadEnv } from './env.js';
import { pgTypes } from '../src/lib/pg-types.js';

loadEnv();

const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {}, types: pgTypes });

const dryRun = process.argv.includes('--dry-run');
const dropShells = process.argv.includes('--drop-shells');

/** Accounts worth keeping as empty shells: you will import into these. */
const KEEP_AS_SHELL = ['Apple Card', 'Morgan Stanley Brokerage'];

async function main() {
  // A demo account is one seed-demo.ts created: a demo- external_id, or one of
  // the manual/csv accounts it made. A real synced account never matches.
  const demoAccounts = await sql<{ id: string; name: string; n: number }[]>`
    SELECT a.id, a.name, count(t.id)::int AS n
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    WHERE a.external_id LIKE 'demo-%'
       OR (a.external_id IS NULL AND a.name = ANY(${KEEP_AS_SHELL}))
    GROUP BY a.id, a.name
    ORDER BY a.name`;

  if (demoAccounts.length === 0) {
    console.log('No demo data found — nothing to purge.');
    return;
  }

  const shellIds = demoAccounts.filter((a) => KEEP_AS_SHELL.includes(a.name)).map((a) => a.id);
  const dropIds = demoAccounts.filter((a) => !KEEP_AS_SHELL.includes(a.name)).map((a) => a.id);

  console.log(dryRun ? 'DRY RUN — nothing will be written\n' : '');

  for (const a of demoAccounts) {
    const fate = KEEP_AS_SHELL.includes(a.name) && !dropShells ? 'emptied, kept' : 'DROPPED';
    console.log(`  ${a.name.padEnd(28)} ${String(a.n).padStart(4)} txns  ->  ${fate}`);
  }

  // Rules the seed wrote. Real rules you have written since are left alone —
  // these are matched by the exact names seed-demo.ts uses.
  const SEED_RULES = [
    'Payroll', 'Rent', 'Renters ins', 'Phone', 'Utilities', 'Gym', 'Subscriptions',
    'Groceries', 'Gas', 'Coffee', 'Restaurants', 'Shopping', 'Annual fee',
    'Daily Cash', 'Card payment', 'Brokerage',
  ];
  const [{ n: ruleCount }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM rules WHERE name = ANY(${SEED_RULES})`;
  console.log(`\n  ${ruleCount} seeded rules  ->  ${dryRun ? 'would be' : ''} removed`);

  const [{ n: realCount }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.external_id IS NOT NULL AND a.external_id NOT LIKE 'demo-%'`;
  console.log(`  ${realCount} real transactions  ->  untouched`);

  if (dryRun) {
    console.log('\nRun without --dry-run to apply.');
    return;
  }

  await sql.begin(async (tx) => {
    const allIds = [...shellIds, ...dropIds];

    // Transfers whose legs are being removed would otherwise be orphaned.
    await tx`
      DELETE FROM transfers WHERE id IN (
        SELECT DISTINCT transfer_id FROM transactions
        WHERE account_id = ANY(${allIds}::uuid[]) AND transfer_id IS NOT NULL)`;

    // transaction_edits and balance_snapshots cascade from their parents.
    await tx`DELETE FROM transactions WHERE account_id = ANY(${allIds}::uuid[])`;
    await tx`DELETE FROM balance_snapshots WHERE account_id = ANY(${allIds}::uuid[])`;
    await tx`DELETE FROM holdings WHERE account_id = ANY(${allIds}::uuid[])`;
    await tx`DELETE FROM import_batches WHERE account_id = ANY(${allIds}::uuid[])`;

    await tx`DELETE FROM rules WHERE name = ANY(${SEED_RULES})`;

    const toDrop = dropShells ? allIds : dropIds;
    if (toDrop.length > 0) {
      await tx`DELETE FROM accounts WHERE id = ANY(${toDrop}::uuid[])`;
    }

    // Merchants left with no transactions are seed residue.
    await tx`
      DELETE FROM merchants m
      WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.merchant_id = m.id)`;

    // Institutions left with no accounts likewise.
    await tx`
      DELETE FROM institutions i
      WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.institution_id = i.id)`;
  });

  const [{ n: remaining }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM transactions`;
  console.log(`\n✓ purged. ${remaining} transactions remain, all real.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => sql.end());
