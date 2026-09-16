/**
 * Run the transfer matcher and report what it could not decide.
 *
 *   npx tsx scripts/match-transfers.ts              # link + list candidates
 *   npx tsx scripts/match-transfers.ts --dry-run    # list only
 *   npx tsx scripts/match-transfers.ts --link <a> <b>   # confirm a pair by id
 *
 * Above ~0.90 confidence pairs link automatically; below that they are listed
 * here for a human to confirm, because a wrong link removes two real
 * transactions from spending.
 */
import postgres from 'postgres';
import { loadEnv } from './env.js';
import { pgTypes } from '../src/lib/pg-types.js';
import { matchTransfers, linkPair } from '../src/transfers/match.js';

loadEnv();
const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {}, types: pgTypes });

const dryRun = process.argv.includes('--dry-run');
const linkIdx = process.argv.indexOf('--link');

async function main() {
  if (linkIdx >= 0) {
    const a = process.argv[linkIdx + 1];
    const b = process.argv[linkIdx + 2];
    if (!a || !b) throw new Error('Usage: --link <transaction-id> <transaction-id>');
    const id = await linkPair(sql, a, b, 'manual');
    console.log(`✓ linked as transfer ${id}`);
    return;
  }

  const r = await matchTransfers(sql, { dryRun, log: (m) => console.log(m) });
  console.log(`\n${r.linked} linked · ${r.candidates.length} need a decision`);

  if (r.candidates.length === 0) return;

  console.log('\nThese look like pairs but scored below the auto-link threshold.');
  console.log('Confirm one with:  npx tsx scripts/match-transfers.ts --link <id-a> <id-b>\n');

  for (const c of r.candidates) {
    console.log(`  confidence ${c.confidence}  ·  $${(Math.abs(c.amountCents) / 100).toFixed(2)}  ·  ${c.dayGap} day gap`);
    console.log(`    ${c.aId}  ${c.aAccount}`);
    console.log(`      ${c.aDescription.slice(0, 64)}`);
    console.log(`    ${c.bId}  ${c.bAccount}`);
    console.log(`      ${c.bDescription.slice(0, 64)}`);
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
