/**
 * Re-run the categorizer over a date range (DESIGN.md §8). The main
 * development loop: tweak rules, re-run, look at what changed.
 *
 *   npm run recategorize -- --from 2026-01-01
 *   npm run recategorize -- --from 2026-01-01 --no-llm
 *
 * Safe to run any number of times. Locked rows are never touched.
 */
import postgres from 'postgres';
import { loadEnv } from './env.js';
import { pgTypes } from '../src/lib/pg-types.js';
import { runCategorization, refreshSuggestions } from '../src/categorize/run.js';

loadEnv();

const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {}, types: pgTypes });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function main() {
  const from = arg('from');
  const to = arg('to');
  const noLlm = process.argv.includes('--no-llm');

  console.log(`recategorize${from ? ` from ${from}` : ' (all time)'}${to ? ` to ${to}` : ''}`);

  const [{ locked }] = await sql<{ locked: number }[]>`
    SELECT count(*)::int AS locked FROM transactions WHERE category_locked`;
  console.log(`· ${locked} rows are locked and will not be touched`);

  const report = await runCategorization(sql, { from, to, noLlm, log: (m) => console.log(m) });

  console.log('');
  console.log(`  merchants linked      ${report.merchantsLinked} (${report.merchantsCreated} new)`);
  console.log(`  by merchant default   ${report.byMerchantDefault}`);
  console.log(`  by rule               ${report.byRule}`);
  console.log(`  by model              ${report.byLlm}${report.llmSkipped ? ` (skipped: ${report.llmSkipped})` : ''}`);
  console.log(`  to Uncategorized      ${report.toUncategorized}`);

  const suggestions = await refreshSuggestions(sql);
  if (suggestions > 0) console.log(`  suggestions refreshed ${suggestions}`);

  // Locked rows whose suggestion disagrees are exactly the cases where a rule
  // would have saved a manual edit (DESIGN.md §8).
  const disagreements = await sql<{ raw_description: string; chose: string; suggested: string }[]>`
    SELECT t.raw_description, c.name AS chose, s.name AS suggested
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    JOIN categories s ON s.id = t.suggested_category_id
    WHERE t.category_locked AND t.suggested_category_id IS DISTINCT FROM t.category_id
    LIMIT 10`;

  if (disagreements.length > 0) {
    console.log('\n· rules worth writing (you overrode the machine here):');
    for (const d of disagreements) {
      console.log(`  ${d.raw_description.slice(0, 40).padEnd(42)} you: ${d.chose}  machine: ${d.suggested}`);
    }
  }

  for (const e of report.errors) console.error(`! ${e}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => sql.end());
