/**
 * A second, synthetic ledger to design against.
 *
 *   npm run demo:setup   # (re)create finance_demo and seed it — synthetic only
 *   npm run dev:demo     # the app on 127.0.0.1:3001, reading finance_demo
 *
 * Design work produces screenshots, Figma pushes, visual-test baselines and
 * published pages — all of which leave this machine, some into a public repo.
 * The real ledger must not be in any of them. So this database sits beside
 * the real one in the same Postgres, named finance_demo, and holds only what
 * scripts/seed-demo.ts invents — pinned to a fixed date so it renders the same
 * every time.
 *
 * It runs on its own port and its own build directory, so the real app on
 * :3000 and the demo on :3001 can run side by side. The demo URL is derived
 * from DATABASE_URL by swapping the database name; it is never printed,
 * because it carries the password.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from './env.js';

loadEnv();

const DEMO_DB = 'finance_demo';
const DEMO_PORT = '3001';
/** The date the demo ledger ends on. Fixed, so screenshots are comparable. */
const SEED_TODAY = '2026-09-28';

function urls() {
  const real = process.env.DATABASE_URL;
  if (!real) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');
  const demo = new URL(real);
  demo.pathname = `/${DEMO_DB}`;
  // The guard everything below relies on: every write in this file goes to a
  // database whose name ends in _demo, never to the one in DATABASE_URL.
  if (!demo.pathname.endsWith('_demo') || demo.toString() === real) {
    throw new Error('Refusing: the demo URL does not point at a _demo database.');
  }
  return { real, demo: demo.toString() };
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function setup() {
  const { real, demo } = urls();

  // Create it beside the real database (connecting to the real one only to
  // issue CREATE DATABASE — nothing in the real ledger is read or written).
  const admin = postgres(real, { max: 1, onnotice: () => {} });
  try {
    const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${DEMO_DB}`;
    if (!exists) {
      await admin.unsafe(`CREATE DATABASE ${DEMO_DB}`);
      console.log(`· created ${DEMO_DB}`);
    }
  } finally {
    await admin.end();
  }

  // Start clean every time: drop and re-apply the schema, then seed.
  const sql = postgres(demo, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sql.unsafe(readFileSync('db/schema.sql', 'utf8'));
    console.log(`· applied db/schema.sql to ${DEMO_DB}`);
  } finally {
    await sql.end();
  }

  const code = await run('npx', ['tsx', 'scripts/seed-demo.ts'], {
    ...process.env, DATABASE_URL: demo, SEED_TODAY,
  });
  if (code !== 0) throw new Error(`seeding ${DEMO_DB} failed`);
  console.log(`\n✓ ${DEMO_DB} is ready — synthetic data ending ${SEED_TODAY}. Run: npm run dev:demo`);
}

async function dev() {
  const { demo } = urls();
  console.log(`· demo app on http://127.0.0.1:${DEMO_PORT}, reading ${DEMO_DB}`);
  // NEXT_DIST_DIR keeps its build apart from the real app's .next, so both
  // dev servers can run at once.
  const code = await run('npx', ['next', 'dev', '-H', '127.0.0.1', '-p', DEMO_PORT], {
    ...process.env, DATABASE_URL: demo, NEXT_DIST_DIR: '.next-demo',
  });
  process.exitCode = code;
}

const cmd = process.argv[2];
(cmd === 'setup' ? setup() : cmd === 'dev' ? dev() : Promise.reject(new Error('usage: demo-db.ts setup | dev')))
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
