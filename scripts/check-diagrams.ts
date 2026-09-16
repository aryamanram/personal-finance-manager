/**
 * Render every mermaid block in docs/architecture/ to catch syntax errors.
 *
 *   npx tsx scripts/check-diagrams.ts
 *
 * tests/architecture.test.ts checks that the FACTS in the docs are still true
 * (paths, tables, scripts). This checks that the diagrams still DRAW — a broken
 * block renders as an error box on GitHub, which is worse than no diagram.
 *
 * Kept out of `npm test` because it downloads a headless browser on first run.
 * Run it when you change a diagram.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DOCS = 'docs/architecture';
const work = mkdtempSync(join(tmpdir(), 'diagrams-'));
let checked = 0;
const failures: string[] = [];

try {
  for (const file of readdirSync(DOCS).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(join(DOCS, file), 'utf8');
    const blocks = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);

    blocks.forEach((block, i) => {
      const name = `${file.replace('.md', '')}-${i}`;
      const src = join(work, `${name}.mmd`);
      writeFileSync(src, block);
      checked++;

      try {
        // execFileSync with an argument array: no shell, so a path cannot be
        // interpreted as a command.
        execFileSync('npx', ['-y', 'mmdc', '-i', src, '-o', join(work, `${name}.svg`)], {
          stdio: 'pipe',
        });
        console.log(`  ✓ ${file} diagram ${i + 1}`);
      } catch (err) {
        const detail = err instanceof Error && 'stderr' in err
          ? String((err as { stderr: Buffer }).stderr).split('\n').filter(Boolean).slice(-3).join(' ')
          : String(err);
        failures.push(`${file} diagram ${i + 1}: ${detail}`);
        console.error(`  ✗ ${file} diagram ${i + 1}`);
      }
    });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} diagram(s) failed to render:\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`\n✓ ${checked} diagrams render`);
