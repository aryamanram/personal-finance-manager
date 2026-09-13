/**
 * Postgres connection. db/schema.sql is the source of truth for the shape of
 * everything here (DESIGN.md §4) — these types are hand-mirrored from it.
 */
import 'server-only';
import postgres from 'postgres';
import { loadEnv } from './env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');

// Next dev mode re-evaluates modules on every hot reload; reuse the pool.
const globalForDb = globalThis as unknown as { __financeSql?: postgres.Sql };

export const sql =
  globalForDb.__financeSql ??
  postgres(url, {
    max: 10,
    // BIGINT (cents) arrives as a string by default. Every monetary value in
    // this schema is well inside Number.MAX_SAFE_INTEGER ($90 trillion), so
    // parse to number and assert rather than threading BigInt through the UI.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number | bigint) => v.toString(),
        parse: (v: string) => {
          const n = Number(v);
          if (!Number.isSafeInteger(n)) throw new Error(`bigint out of safe range: ${v}`);
          return n;
        },
      },
    },
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__financeSql = sql;
