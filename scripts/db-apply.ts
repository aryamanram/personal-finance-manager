/**
 * Applies db/schema.sql to DATABASE_URL.
 *
 * schema.sql is the authoritative DDL (DESIGN.md §4) and is written to run
 * against an empty database, so --reset drops and recreates the public schema
 * first. Without --reset this will fail on an already-populated DB, which is
 * intentional: it should never half-apply over real data.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { loadEnv } from './env.js';

loadEnv();

const reset = process.argv.includes('--reset');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');

const sql = postgres(url, { max: 1, onnotice: () => {} });

const ddl = readFileSync(resolve(process.cwd(), 'db/schema.sql'), 'utf8');

try {
  if (reset) {
    console.log('· dropping public schema');
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  console.log('· applying db/schema.sql');
  await sql.unsafe(ddl);

  const [{ count: tables }] = await sql`
    SELECT count(*)::int FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const [{ count: views }] = await sql`
    SELECT count(*)::int FROM information_schema.views WHERE table_schema = 'public'`;
  const [{ count: cats }] = await sql`SELECT count(*)::int FROM categories`;

  console.log(`✓ ${tables} tables, ${views} views, ${cats} seeded categories`);
} finally {
  await sql.end();
}
