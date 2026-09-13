/**
 * Postgres connection. db/schema.sql is the source of truth for the shape of
 * everything here (DESIGN.md §4) — these types are hand-mirrored from it.
 */
import 'server-only';
import postgres from 'postgres';
import { loadEnv } from './env';
import { pgTypes } from './pg-types';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');

// Next dev mode re-evaluates modules on every hot reload; reuse the pool.
const globalForDb = globalThis as unknown as { __financeSql?: postgres.Sql };

export const sql =
  globalForDb.__financeSql ??
  postgres(url, {
    max: 10,
    types: pgTypes,
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__financeSql = sql;
