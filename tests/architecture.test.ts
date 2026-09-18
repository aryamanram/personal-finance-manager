/**
 * Keeps docs/architecture/ honest.
 *
 * Diagrams are hand-written, because a generated one shows a dependency graph
 * rather than an architecture — it cannot say "this pass is idempotent" or "this
 * is the only path to the database". Hand-written diagrams drift, though, and a
 * confidently wrong diagram is worse than none.
 *
 * So the prose stays hand-written and the FACTS are checked: every file path,
 * database table and npm script the docs name must still exist. Rename a module
 * and this test names the diagram that went stale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_DIR = 'docs/architecture';

const docs = readdirSync(DOCS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ file: join(DOCS_DIR, f), text: readFileSync(join(DOCS_DIR, f), 'utf8') }));

/** Strip fenced code blocks: SQL samples name columns, not paths. */
function prose(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

describe('the architecture docs exist and link up', () => {
  it('has all four levels', () => {
    for (const f of ['README.md', 'containers.md', 'components.md', 'data-flow.md']) {
      expect(existsSync(join(DOCS_DIR, f)), `${f} is missing`).toBe(true);
    }
  });

  it('links only to sibling docs that exist', () => {
    for (const { file, text } of docs) {
      const links = [...text.matchAll(/\]\(\.\/([\w.-]+\.md)\)/g)].map((m) => m[1]);
      for (const link of links) {
        expect(existsSync(join(DOCS_DIR, link)), `${file} links to missing ${link}`).toBe(true);
      }
    }
  });

  it('renders every mermaid block as a supported diagram type', () => {
    // C4Context is deliberately avoided: mermaid documents it as experimental
    // and it needs per-element pixel offsets to lay out.
    for (const { file, text } of docs) {
      const blocks = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1].trim());
      expect(blocks.length, `${file} has no diagram`).toBeGreaterThan(0);
      for (const b of blocks) {
        // Blocks open with a %%{init ... }%% theme directive that spans several
        // lines; strip it before reading the diagram declaration.
        const body = b.replace(/%%\{[\s\S]*?\}%%/g, '').trim();
        expect(body, `${file} uses a non-flowchart diagram`).toMatch(/^flowchart\s/);
      }
    }
  });
});

describe('every path the docs name still exists', () => {
  it('finds each referenced source file', () => {
    const missing: string[] = [];

    for (const { file, text } of docs) {
      // Paths appear as `src/lib/db.ts` or `docs/architecture/x.md` in backticks
      // or in bold inside a diagram label.
      const paths = new Set<string>();
      for (const m of prose(text).matchAll(/`((?:src|scripts|tests|db|docs)\/[\w./[\]-]+)`/g)) {
        paths.add(m[1]);
      }
      // Diagram labels use a bare filename in bold; resolve those separately.
      for (const p of paths) {
        if (!existsSync(p)) missing.push(`${file} → ${p}`);
      }
    }

    expect(missing, `stale paths:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('finds each module named in a diagram label', () => {
    // Diagram nodes read <b>upsert.ts</b> or <b>categorize/run.ts</b>. Resolve
    // each against the directories the surrounding subgraph covers.
    const ROOTS = ['src', 'src/ingest', 'src/lib', 'src/categorize', 'src/transfers', 'scripts'];
    const missing: string[] = [];

    for (const { file, text } of docs) {
      const labels = [...text.matchAll(/<b>([\w./-]+\.tsx?)<\/b>/g)].map((m) => m[1]);
      for (const label of labels) {
        const found = ROOTS.some((root) => existsSync(join(root, label)));
        if (!found) missing.push(`${file} → ${label}`);
      }
    }

    expect(missing, `modules named in a diagram but not on disk:\n  ${missing.join('\n  ')}`)
      .toEqual([]);
  });
});

describe('every database object the docs name still exists', () => {
  const schema = readFileSync('db/schema.sql', 'utf8');

  it('finds each table and view', () => {
    const declared = new Set<string>();
    for (const m of schema.matchAll(/CREATE (?:TABLE|VIEW|OR REPLACE VIEW)\s+(\w+)/gi)) {
      declared.add(m[1].toLowerCase());
    }

    const missing: string[] = [];
    for (const { file, text } of docs) {
      const named = new Set<string>();
      for (const m of prose(text).matchAll(/`(v_\w+|transactions|accounts|balance_snapshots|transaction_edits|merchants|rules|categories)`/g)) {
        named.add(m[1].toLowerCase());
      }
      // `transactions.amount_cents` style references resolve to their table.
      for (const m of prose(text).matchAll(/`(\w+)\.\w+`/g)) {
        if (declared.has(m[1].toLowerCase())) named.add(m[1].toLowerCase());
      }
      for (const n of named) {
        if (!declared.has(n)) missing.push(`${file} → ${n}`);
      }
    }

    expect(missing, `tables/views named in docs but not in schema.sql:\n  ${missing.join('\n  ')}`)
      .toEqual([]);
  });

  it('finds each eff_* column the docs promise', () => {
    const view = schema.slice(schema.indexOf('CREATE VIEW v_transactions'));
    for (const col of [
      'eff_amount_cents', 'eff_posted_date', 'eff_description',
      'eff_cost_type', 'eff_necessity', 'counts_as_spending',
    ]) {
      expect(view, `v_transactions no longer exposes ${col}`).toContain(col);
    }
  });
});

/**
 * Labels the container diagram uses for the batch passes. Each must resolve to
 * a real npm script — these are the names someone will type.
 */
const PASS_LABELS = new Set(['sync', 'recategorize', 'import', 'transfers', 'seed', 'dev']);

describe('every npm script the docs name still exists', () => {
  it('finds each one in package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    const missing: string[] = [];
    for (const { file, text } of docs) {
      const named = new Set<string>();

      // "npm run sync", in prose or a code fence.
      for (const m of text.matchAll(/npm run ([\w:-]+)/g)) named.add(m[1]);

      // A diagram label naming a pass by its bare script name — <b>sync</b>,
      // <b>recategorize</b>. Without this the check passed vacuously: the docs
      // name four passes but spell only two of them "npm run".
      for (const m of text.matchAll(/<b>([a-z][\w-]*)<\/b>/g)) {
        if (m[1] in pkg.scripts) named.add(m[1]);
        // Flag a label that LOOKS like a pass but matches no script.
        else if (PASS_LABELS.has(m[1])) missing.push(`${file} → <b>${m[1]}</b>`);
      }

      for (const name of named) {
        if (!(name in pkg.scripts)) missing.push(`${file} → npm run ${name}`);
      }
    }

    expect(missing, `scripts named in docs but not in package.json:\n  ${missing.join('\n  ')}`)
      .toEqual([]);
  });
});

/**
 * The diagrams hardcode their palette — Mermaid has no access to CSS custom
 * properties — so a recolour of the app has to be repeated here by hand. That
 * is exactly the kind of edit that changes a fill and forgets the text sitting
 * on it: the cool-palette pass left three person nodes at 3.47:1 because the
 * fill moved and `color:` did not.
 */
describe('diagram text stays legible on its own fill', () => {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const parse = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  });
  const luminance = (hex: string) => {
    const { r, g, b } = parse(hex);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('keeps every classDef above 4.5:1', () => {
    // Node labels render at 14px with 11px spans — normal-size text, so AA is
    // 4.5:1 rather than the 3:1 large-text threshold.
    const failures: string[] = [];

    for (const { file, text } of docs) {
      for (const line of text.split('\n')) {
        const m = /classDef\s+(\w+).*?fill:(#[0-9a-fA-F]{6}).*?color:(#[0-9a-fA-F]{6})/.exec(line);
        if (!m) continue;
        const [, name, fill, color] = m;
        const ratio = contrast(color, fill);
        if (ratio < 4.5) {
          failures.push(`${file} classDef ${name}: ${color} on ${fill} is ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(failures, `diagram text below WCAG AA:\n  ${failures.join('\n  ')}`).toEqual([]);
  });
});
