/**
 * The nightly sync. Invoke from system cron (DESIGN.md §4) — there is no
 * in-process scheduler, so this stays runnable by hand.
 *
 *   0 6 * * *  cd /path/to/finance && /usr/local/bin/npm run sync >> sync.log 2>&1
 *
 * Exit codes: 0 ok, 1 failed, 2 partial (a connection is broken but others
 * synced), 3 misconfigured.
 */
import postgres from 'postgres';
import { loadEnv } from './env.js';
import { pgTypes } from '../src/lib/pg-types.js';
import { runSync } from '../src/ingest/sync.js';
import { runCategorization } from '../src/categorize/run.js';
import { matchTransfers } from '../src/transfers/match.js';
import { redactUrl } from '../src/ingest/simplefin.js';

loadEnv();

const accessUrl = process.env.SIMPLEFIN_ACCESS_URL;
if (!accessUrl) {
  console.error(
    'SIMPLEFIN_ACCESS_URL is not set.\n' +
    'Get a setup token at https://beta-bridge.simplefin.org/, then run:\n' +
    '  npx tsx scripts/claim-simplefin.ts <token>',
  );
  process.exit(3);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {}, types: pgTypes });

const args = process.argv.slice(2);
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1];
const noLlm = args.includes('--no-llm');

/** Runs sync, categorization, and transfer matching for the nightly job. */
async function main() {
  const started = Date.now();
  console.log(`sync · ${new Date().toISOString()}`);
  console.log(`· endpoint ${redactUrl(accessUrl!)}`);

  const result = await runSync(sql, {
    accessUrl: accessUrl!,
    since: sinceArg ? new Date(sinceArg) : undefined,
    log: (m) => console.log(m),
  });

  console.log(
    `· ${result.accountsSynced} accounts · +${result.inserted} new · ` +
    `${result.updated} updated · ${result.adopted} adopted · ${result.superseded} superseded`,
  );

  if (result.inserted > 0 || result.adopted > 0) {
    const cat = await runCategorization(sql, { noLlm, log: (m) => console.log(m) });
    console.log(`· categorized ${cat.byRule} by rule, ${cat.byLlm} by model`);
    if (cat.toUncategorized > 0) {
      console.log(`  ! ${cat.toUncategorized} left uncategorized — worth a rule`);
    }
    // runCategorization RETURNS LLM failures rather than throwing them, so one
    // bad batch does not abandon the merchants already categorized. Under cron
    // the exit code is the only signal anyone sees, so surface them here.
    for (const e of cat.errors) result.errors.push(`categorization: ${e}`);

    const tr = await matchTransfers(sql, { log: (m) => console.log(m) });
    console.log(`· ${tr.linked} transfers linked, ${tr.candidates.length} need review`);
  }

  for (const e of result.errors) console.error(`! ${e}`);
  for (const n of result.notices) console.log(`+ ${n}`);

  if (result.rateLimited) {
    console.error(
      '\n! The bridge is warning about request volume. It expects <= 24 requests\n' +
      '  per day and will DISABLE the access token if the warnings are ignored,\n' +
      '  which means re-claiming a setup token. Stop running sync by hand today.',
    );
  }

  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s · ${result.status}`);
  process.exitCode = result.status === 'ok' ? 0 : result.status === 'partial' ? 2 : 1;
}

main()
  .catch((err) => {
    // Never let a credentialed URL reach a log file.
    console.error('sync failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
