/**
 * Pre-push privacy guard.
 *
 *   npx tsx scripts/check-privacy.ts
 *
 * This repo holds the code for a financial tracker, never the finances. The
 * check fails loudly rather than warning, because the failure mode — a
 * statement or a credential in a public repo — is not undoable by deleting the
 * file afterwards.
 *
 * Wire it into a pre-push hook:
 *   echo 'npx tsx scripts/check-privacy.ts' > .git/hooks/pre-push
 *   chmod +x .git/hooks/pre-push
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const problems: string[] = [];
const notes: string[] = [];

/** Runs a Git command and returns empty output when the command fails. */
function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

const tracked = sh('git ls-files').split('\n').filter(Boolean);

// --- 1. Files that should never be tracked, whatever their contents ---------
const FORBIDDEN = [
  // Anchored on the basename, not the root, so a forced-added
  // config/.env.production cannot slip past.
  { re: /(^|\/)\.env(\..*)?$/, unless: /(^|\/)\.env\.example$/, what: 'environment file' },
  { re: /\.(ofx|qfx|qbo|pdf)$/i, what: 'financial export' },
  { re: /^db\/dumps\//, what: 'database dump' },
  { re: /^(data|private)\//, what: 'private directory' },
  { re: /\.(pem|key|p12|pfx)$/i, what: 'key material' },
];

for (const file of tracked) {
  for (const rule of FORBIDDEN) {
    if (rule.re.test(file) && !(rule.unless?.test(file))) {
      problems.push(`${file} — ${rule.what} must not be tracked`);
    }
  }
}

// --- 2. CSVs: only the named synthetic fixtures -----------------------------
const ALLOWED_CSV = new Set([
  'fixtures/applecard-negative.csv',
  'fixtures/applecard-positive.csv',
]);
for (const file of tracked.filter((f) => f.endsWith('.csv'))) {
  if (!ALLOWED_CSV.has(file)) {
    problems.push(`${file} — untracked-by-default CSV. If it is synthetic, add it to ALLOWED_CSV and .gitignore.`);
  }
}

// --- 3. Credential shapes, in the working tree AND in history ---------------
const CREDENTIALS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9-]{16,}/, 'Anthropic API key'],
  [/SIMPLEFIN_ACCESS_URL\s*=\s*https:\/\/\S+:\S+@/, 'SimpleFIN access URL with credentials'],
  // Any host, not just SimpleFIN: a credential in a URL is a credential
  // whoever it authenticates to.
  [/https?:\/\/[^\s:@/]+:[^\s:@/]+@[\w.-]+/i, 'URL with embedded credentials'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
];

for (const file of tracked) {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;   // binary or unreadable
  }
  for (const [re, what] of CREDENTIALS) {
    const m = re.exec(content);
    if (!m) continue;
    // tests/sync.test.ts deliberately contains a fake credentialed URL to
    // assert that redaction works. It uses example.com, which is reserved.
    if (m[0].includes('example.com')) continue;
    problems.push(`${file} — looks like a ${what}`);
  }
}

// History matters: deleting a file does not remove it from earlier commits.
// ':(glob)' makes the pattern match at any depth, so config/.env.production is
// caught as well as a root .env. ':(exclude)' keeps .env.example legal.
const historyHits = sh(
  `git log --all --pretty=format:%H -- ':(glob)**/.env' ':(glob)**/.env.*' ` +
  `':(glob).env' ':(glob).env.*' ':(glob)data/**' ':(glob)private/**' ` +
  `':(exclude,glob)**/.env.example' ':(exclude,glob).env.example' 2>/dev/null`,
).split('\n').filter(Boolean);
if (historyHits.length > 0) {
  problems.push(
    `${historyHits.length} commit(s) touched an env or private path. ` +
    `Deleting the file does not remove it from history — rewrite before pushing.`,
  );
}

// --- 3b. Financial figures in tracked docs ---------------------------------
// Prose is where this leaks. A balance written into a design note is as public
// as one written into code, and easier to overlook in review — this check exists
// because exactly that happened: a real brokerage balance reached docs/STATE.md
// in the same commit that added a rule forbidding it.
const DOC_PATHS = tracked.filter(
  (f) => f.endsWith('.md') && !f.startsWith('node_modules'),
);
/** Four or more significant digits: $1,234.56 or $12345. Ignores $0-$999. */
const BIG_MONEY = /\$\s?\d{1,3}(,\d{3})+(\.\d{2})?|\$\s?\d{4,}(\.\d{2})?/g;

for (const file of DOC_PATHS) {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  // Fenced code blocks hold worked examples and schema snippets.
  const prose = content.replace(/```[\s\S]*?```/g, '');
  const hits = [...new Set(prose.match(BIG_MONEY) ?? [])];

  // Figures that are illustrative rather than personal, used in the design docs
  // to explain a calculation.
  const ILLUSTRATIVE = new Set(['$80,000', '$87,200', '$4,000', '$3,200', '$2,000', '$1,234.56']);
  const real = hits.filter((h) => !ILLUSTRATIVE.has(h.replace(/\s/g, '')));

  if (real.length > 0) {
    problems.push(
      `${file} — contains ${real.length} large dollar figure(s) (${real.slice(0, 3).join(', ')}). ` +
      `Real balances belong in private/, not a tracked doc. If illustrative, add to ILLUSTRATIVE.`,
    );
  }
}

// --- 4. Warn on things that are legal but worth a second look --------------
const envExample = tracked.includes('.env.example')
  ? readFileSync('.env.example', 'utf8') : '';
for (const line of envExample.split('\n')) {
  const m = /^([A-Z_]+)=(.+)$/.exec(line.trim());
  if (m && m[1] !== 'DATABASE_URL' && m[2] && !m[2].startsWith('#')) {
    notes.push(`.env.example sets ${m[1]} to a non-empty value — is that a placeholder?`);
  }
}

// --- Report ----------------------------------------------------------------
if (notes.length > 0) {
  console.log('Notes:');
  for (const n of notes) console.log(`  · ${n}`);
  console.log('');
}

if (problems.length > 0) {
  console.error('PRIVACY CHECK FAILED\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s). Nothing was pushed.`);
  process.exit(1);
}

console.log(`✓ privacy check passed — ${tracked.length} tracked files, no secrets or financial data`);
