/**
 * Import a statement CSV from the command line.
 *
 *   npx tsx scripts/import-csv.ts <file> --account "Chase Checking" --dry-run
 *   npx tsx scripts/import-csv.ts <file> --account "Chase Checking"
 *
 * Format is detected from the header. Always dry-run first: the preview shows
 * the row count, date range, computed total and detected sign convention, and
 * writes nothing.
 *
 * Re-import safe. Rows already present — whether they arrived by an earlier
 * import or by API sync — are counted as duplicates, not inserted again.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from './env.js';
import { pgTypes } from '../src/lib/pg-types.js';
import { parseChaseCsv, toCanonical as chaseToCanonical } from '../src/ingest/chase-csv.js';
import { parseAppleCardCsv, toCanonical as appleToCanonical } from '../src/ingest/applecard-csv.js';
import { upsertTransactions } from '../src/ingest/upsert.js';
import { runCategorization } from '../src/categorize/run.js';
import { matchTransfers } from '../src/transfers/match.js';
import { formatCents } from '../src/money.js';

loadEnv();
const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {}, types: pgTypes });

/** Reads a named CLI option in either `--name value` or `--name=value` form. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

/** Imports or previews the statement selected by the command-line arguments. */
async function main() {
  const file = process.argv[2];
  const accountName = arg('account');
  const dryRun = process.argv.includes('--dry-run');

  if (!file || !accountName) {
    console.error('Usage: npx tsx scripts/import-csv.ts <file> --account "<name>" [--dry-run]');
    process.exitCode = 1;
    return;
  }

  const content = readFileSync(file, 'utf8');
  const header = content.slice(0, content.indexOf('\n')).toLowerCase();

  // Chase writes a Details column; Apple Card writes Daily Cash.
  const isChase = header.includes('posting date') || header.includes('details');
  const parsed = isChase ? parseChaseCsv(content) : parseAppleCardCsv(content);
  console.log(`· detected ${isChase ? 'Chase' : 'Apple Card'} format`);

  const [account] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM accounts WHERE name = ${accountName}`;
  if (!account) {
    const all = await sql<{ name: string }[]>`SELECT name FROM accounts ORDER BY name`;
    console.error(`No account named "${accountName}". Available:`);
    for (const a of all) console.error(`  ${a.name}`);
    process.exitCode = 1;
    return;
  }

  console.log(`· ${parsed.rows.length} rows · ${parsed.periodStart} -> ${parsed.periodEnd}`);
  console.log(`· net ${formatCents(parsed.totalCents)} · sign ${parsed.signFlipped ? 'FLIPPED' : 'as written'}`);
  for (const w of parsed.warnings.slice(0, 8)) console.log(`  ! ${w}`);

  const canonical = isChase
    ? chaseToCanonical(parsed.rows as never, account.id)
    : appleToCanonical(parsed.rows as never, account.id);

  if (dryRun) {
    console.log('\nDRY RUN — nothing written. Sample:');
    for (const r of canonical.slice(0, 10)) {
      console.log(`  ${r.postedDate}  ${formatCents(r.amountCents).padStart(12)}  ${r.rawDescription.slice(0, 48)}`);
    }
    console.log(`\nRun without --dry-run to import into "${account.name}".`);
    return;
  }

  const [batch] = await sql<{ id: string }[]>`
    INSERT INTO import_batches
      (account_id, source, filename, file_sha256, period_start, period_end, rows_seen)
    VALUES (${account.id}, 'csv', ${file.split('/').pop() ?? file}, ${parsed.fileSha256},
            ${parsed.periodStart}, ${parsed.periodEnd}, ${parsed.rows.length})
    RETURNING id`;

  try {
    const r = await upsertTransactions(sql, canonical, { importBatchId: batch.id });
    await sql`
      UPDATE import_batches SET status='ok', finished_at=now(),
        rows_inserted=${r.inserted}, rows_duplicate=${r.duplicate}
      WHERE id = ${batch.id}`;

    console.log(`\n· ${r.inserted} inserted, ${r.duplicate} already present, ${r.adopted} adopted`);

    const cat = await runCategorization(sql, { noLlm: !process.env.ANTHROPIC_API_KEY });
    console.log(`· categorized ${cat.byRule} by rule, ${cat.toUncategorized} to Uncategorized`);

    const tr = await matchTransfers(sql);
    console.log(`· ${tr.linked} transfers linked, ${tr.candidates.length} need review`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`UPDATE import_batches SET status='failed', finished_at=now(), error=${message}
              WHERE id = ${batch.id}`;
    throw err;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
