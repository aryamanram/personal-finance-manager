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
  // The guard everything below relies on: setup() drops DEMO_DB's schema, so
  // DATABASE_URL must name some other database. Compare the parsed names, not
  // the URL strings — one database has many spellings (POSTGRES://, a
  // trailing ?param), and a string mismatch would wave a demo URL through.
  const realDb = decodeURIComponent(demo.pathname.slice(1));
  if (realDb === DEMO_DB || realDb.endsWith('_demo')) {
    throw new Error(`Refusing: DATABASE_URL already names a demo database (${realDb}). Point it at the real ledger — the demo URL is derived from it.`);
  }
  // postgres.js sends unknown query keys as startup parameters, after the
  // path's database — so ?database=finance would survive the path swap
  // below and win, and setup() would reset the real ledger.
  if (demo.searchParams.has('database')) {
    throw new Error('Refusing: DATABASE_URL has a ?database= parameter, which would override the demo database. Name the database in the path.');
  }
  demo.pathname = `/${DEMO_DB}`;
  return { real, demo: demo.toString() };
}

/**
 * Asks the server which database this connection reached, and refuses unless
 * it is the demo. The URL checks above reason about how the driver will parse
 * a URL; this is the answer, taken on the connection that will do the writing.
 */
async function assertDemo(sql: postgres.Sql) {
  const [{ db }] = await sql`SELECT current_database() AS db`;
  if (db !== DEMO_DB) throw new Error(`Refusing: the demo URL reached ${db}, not ${DEMO_DB}.`);
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
  // max: 1, so the connection that answers assertDemo is the one that drops.
  const sql = postgres(demo, { max: 1, onnotice: () => {} });
  try {
    await assertDemo(sql);
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
  // The demo app is what the design tools are allowed to see; check it is
  // not about to serve the real ledger.
  const sql = postgres(demo, { max: 1, onnotice: () => {} });
  try {
    await assertDemo(sql);
  } finally {
    await sql.end();
  }
  console.log(`· demo app on http://127.0.0.1:${DEMO_PORT}, reading ${DEMO_DB}`);
  // LEDGER_DEMO=1 is read by next.config.mjs: its own build directory, and
  // the only dev server that answers Next's MCP endpoint.
  const code = await run('npx', ['next', 'dev', '-H', '127.0.0.1', '-p', DEMO_PORT], {
    ...process.env, DATABASE_URL: demo, LEDGER_DEMO: '1',
  });
  process.exitCode = code;
}

const cmd = process.argv[2];
(cmd === 'setup' ? setup() : cmd === 'dev' ? dev() : Promise.reject(new Error('usage: demo-db.ts setup | dev')))
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
