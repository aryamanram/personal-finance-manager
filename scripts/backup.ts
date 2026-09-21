/**
 * Snapshot the ledger to a local file, and restore one.
 *
 * The transaction data is NOT recoverable from anywhere else. SimpleFIN and
 * the Apple Card CSVs can rebuild the rows, but everything a human decided —
 * category corrections, locks, amount and date overrides, voided rows,
 * merchant defaults, and the transaction_edits audit log — exists only in this
 * database. A re-sync restores the ledger and loses the judgement applied to
 * it.
 *
 * This exists because that data was once destroyed: `npm run seed` opens with
 * TRUNCATE, and running it against a database holding real accounts wipes
 * them with no undo. Hence `npm run backup` before anything destructive, and
 * the guard in seed-demo.ts that now refuses to run when real rows are
 * present.
 *
 *   npm run backup              # write db/dumps/ledger-<timestamp>.dump
 *   npm run backup -- --list    # show what is stored
 *   npm run backup -- --restore db/dumps/ledger-....dump
 *
 * Dumps are gitignored (db/dumps/, *.dump) and MUST stay that way: this repo
 * is public and a dump is the whole ledger in one file. Keep copies somewhere
 * private — an encrypted volume or a personal drive, never a public remote.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './env.js';

loadEnv();

const DUMP_DIR = 'db/dumps';
/** The compose service name; pg_dump runs inside it so no local client is needed. */
const CONTAINER = 'finance-db';

function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    database: u.pathname.replace(/^\//, ''),
  };
}

/** Human-readable size, so `--list` is scannable. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function list() {
  if (!existsSync(DUMP_DIR)) {
    console.log('No backups yet. Run `npm run backup` to make one.');
    return;
  }
  const files = readdirSync(DUMP_DIR)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => ({ f, s: statSync(join(DUMP_DIR, f)) }))
    .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);

  if (files.length === 0) {
    console.log('No backups yet. Run `npm run backup` to make one.');
    return;
  }
  console.log(`${files.length} backup${files.length === 1 ? '' : 's'} in ${DUMP_DIR}:\n`);
  for (const { f, s } of files) {
    console.log(`  ${f}  ${size(s.size).padStart(8)}  ${s.mtime.toISOString().slice(0, 16).replace('T', ' ')}`);
  }
}

function backup() {
  const { user, database } = parseDbUrl(process.env.DATABASE_URL!);
  mkdirSync(DUMP_DIR, { recursive: true });

  // Colons are legal in a filename but awkward to type when restoring.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const out = join(DUMP_DIR, `ledger-${stamp}.dump`);

  // -Fc is the custom format: compressed, and restorable with --clean so a
  // restore replaces rather than merges. Run inside the container so this
  // works without a local postgresql-client, and so the server and client
  // versions cannot disagree.
  const dump = execFileSync(
    'docker',
    ['exec', CONTAINER, 'pg_dump', '-U', user, '-d', database, '-Fc'],
    { maxBuffer: 1024 ** 3, encoding: 'buffer' },
  );

  writeFileSync(out, dump);

  const counts = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', user, '-d', database, '-t', '-A', '-c',
      'SELECT count(*) FROM transactions'],
    { encoding: 'utf8' },
  ).trim();

  console.log(`✓ ${out}`);
  console.log(`  ${size(statSync(out).size)} · ${counts} transactions`);
  console.log('\n  Gitignored by design — this file is the whole ledger.');
  console.log('  Keep a copy somewhere private if it matters.');
}

function restore(file: string) {
  if (!existsSync(file)) {
    console.error(`No such backup: ${file}`);
    process.exitCode = 1;
    return;
  }
  const { user, database } = parseDbUrl(process.env.DATABASE_URL!);

  // --clean --if-exists drops what is there first, so a restore is a
  // replacement rather than a merge into whatever the database currently
  // holds. Merging two ledgers would silently double every row.
  execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'pg_restore', '-U', user, '-d', database,
      '--clean', '--if-exists', '--no-owner'],
    { input: readFileSync(file), maxBuffer: 1024 ** 3, stdio: ['pipe', 'inherit', 'inherit'] },
  );

  const counts = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', user, '-d', database, '-t', '-A', '-c',
      'SELECT count(*) FROM transactions'],
    { encoding: 'utf8' },
  ).trim();
  console.log(`\n✓ restored ${file} — ${counts} transactions`);
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  list();
} else if (args.includes('--restore')) {
  const file = args[args.indexOf('--restore') + 1];
  if (!file) {
    console.error('Usage: npm run backup -- --restore <file>');
    process.exitCode = 1;
  } else {
    restore(file);
  }
} else {
  backup();
}
