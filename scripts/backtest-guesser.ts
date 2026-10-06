/**
 * How often would the guesser have been right? Measured against the ledger's
 * own human decisions, not against a fixture.
 *
 *   npm run backtest                 # the summary
 *   npm run backtest -- --misses     # plus every wrong guess (local terminal only)
 *
 * Two replays, because they answer different questions:
 *
 *   in order  — each decided row is guessed from ONLY the decisions dated
 *               before it. This is what the guesser actually faced, and it is
 *               the honest number for a ledger that is still growing.
 *   hold-out  — each row is guessed from every OTHER decision. The ceiling:
 *               what it does now that the history is complete.
 *
 * Read-only. Writes nothing.
 */
import postgres from 'postgres';
import { loadEnv } from './env.js';
import { pgTypes } from '../src/lib/pg-types.js';
import { loadDecisions, loadGuessableCategories, type DecidedRow } from '../src/categorize/history.js';
import { buildModel, guess, type Guess } from '../src/categorize/guess.js';

loadEnv();

const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {}, types: pgTypes });
const showMisses = process.argv.includes('--misses');

interface Outcome { row: DecidedRow; g: Guess | null; right: boolean; rollupRight: boolean }

const STEP_LABEL: Record<string, string> = {
  merchant: '1 same merchant', structural: '2 structural', name: '3 shared name (2+ words)',
  keyword: '4 keyword', word: '5 shared name (1 word)', rail: '6 payment rail',
};
const step = (g: Guess | null) => (g ? STEP_LABEL[g.step] : '— no guess');

async function main() {
  const decisions = await loadDecisions(sql);
  const categories = await loadGuessableCategories(sql);
  const parents = await sql<{ id: string; rollup: string }[]>`
    SELECT id, COALESCE(parent_id, id) AS rollup FROM categories`;
  const rollup = new Map(parents.map((p) => [p.id, p.rollup]));

  const replay = (pool: (i: number) => DecidedRow[]): Outcome[] =>
    decisions.map((row, i) => {
      const g = guess(row, buildModel(pool(i), categories));
      return {
        row, g,
        right: g?.categoryId === row.categoryId,
        rollupRight: g !== null && rollup.get(g.categoryId) === rollup.get(row.categoryId),
      };
    });

  const inOrder = replay((i) => decisions.filter((d) => d.postedDate < decisions[i].postedDate));
  const holdOut = replay((i) => decisions.filter((_, j) => j !== i));

  const pct = (n: number, d: number) => (d === 0 ? '  —  ' : `${((100 * n) / d).toFixed(1).padStart(5)}%`);

  const report = (label: string, outs: Outcome[]) => {
    const guessed = outs.filter((o) => o.g);
    const right = outs.filter((o) => o.right).length;
    const rollupRight = outs.filter((o) => o.rollupRight).length;
    console.log(`\n${label} — ${outs.length} decided rows`);
    console.log(`  exact category right   ${String(right).padStart(4)}  ${pct(right, outs.length)}`);
    console.log(`  right parent at least  ${String(rollupRight).padStart(4)}  ${pct(rollupRight, outs.length)}`);
    console.log(`  guessed at all         ${String(guessed.length).padStart(4)}  ${pct(guessed.length, outs.length)}`);
    console.log(`  precision when guessed       ${pct(right, guessed.length)}`);

    const bySteps = new Map<string, { n: number; right: number }>();
    for (const o of outs) {
      const s = step(o.g);
      const b = bySteps.get(s) ?? { n: 0, right: 0 };
      b.n++; if (o.right) b.right++;
      bySteps.set(s, b);
    }
    console.log('  by step:');
    for (const [s, b] of [...bySteps].sort((a, z) => a[0].localeCompare(z[0]))) {
      console.log(`    ${s.padEnd(24)} ${String(b.n).padStart(4)} rows  ${pct(b.right, b.n)} right`);
    }

    // Confidence should mean something: higher bands should be right more often.
    console.log('  by confidence:');
    for (const [lo, hi] of [[0.8, 1.01], [0.6, 0.8], [0.4, 0.6], [0, 0.4]]) {
      const band = guessed.filter((o) => o.g!.confidence >= lo && o.g!.confidence < hi);
      const r = band.filter((o) => o.right).length;
      console.log(`    ${lo.toFixed(1)}–${Math.min(hi, 1).toFixed(1)}   ${String(band.length).padStart(4)} rows  ${pct(r, band.length)} right`);
    }
  };

  report('IN ORDER (only earlier decisions known)', inOrder);
  report('HOLD-OUT (every other decision known)', holdOut);

  if (showMisses) {
    const name = new Map(categories.map((c) => [c.id, c.name]));
    console.log('\nhold-out misses:');
    for (const o of holdOut.filter((x) => !x.right)) {
      console.log(
        `  ${o.row.rawDescription.replace(/\s+/g, ' ').slice(0, 44).padEnd(46)}` +
        ` you: ${(name.get(o.row.categoryId) ?? '?').padEnd(20)}` +
        ` guess: ${o.g ? `${name.get(o.g.categoryId)} — ${o.g.reason}` : '—'}`,
      );
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => sql.end());
