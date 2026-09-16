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
  { re: /^\.env(\..*)?$/, unless: /^\.env\.example$/, what: 'environment file' },
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
  [/https:\/\/[^\s:@/]+:[^\s:@/]+@[\w.-]*simplefin/i, 'SimpleFIN credentialed URL'],
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
const historyHits = sh(
  `git log --all --pretty=format:%H -- '*.env' '*.env.local' 'data/*' 'private/*' 2>/dev/null`,
).split('\n').filter(Boolean);
if (historyHits.length > 0) {
  problems.push(
    `${historyHits.length} commit(s) touched an env or private path. ` +
    `Deleting the file does not remove it from history — rewrite before pushing.`,
  );
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
