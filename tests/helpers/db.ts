/**
 * Integration-test harness. Each suite gets its own scratch database created
 * from db/schema.sql, so tests never touch the dev DB and can run in any order.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { config } from 'dotenv';
import { pgTypes } from '../../src/lib/pg-types';

config({ path: '.env.local', quiet: true });

const BASE = process.env.DATABASE_URL ??
  'postgres://finance:finance_dev_local@localhost:5433/finance';

export async function createTestDb(name: string) {
  const dbName = `test_${name}_${Date.now().toString(36)}`;
  const admin = postgres(BASE, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = BASE.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const sql = postgres(url, { max: 2, onnotice: () => {}, types: pgTypes });
  await sql.unsafe(readFileSync('db/schema.sql', 'utf8'));

  return {
    sql,
    async drop() {
      await sql.end();
      const a = postgres(BASE, { max: 1, onnotice: () => {} });
      await a.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Minimal account fixtures matching DESIGN.md §1. */
export async function seedAccounts(sql: postgres.Sql) {
  const [chase] = await sql<{ id: string }[]>`
    INSERT INTO institutions (name, source) VALUES ('Chase', 'simplefin') RETURNING id`;
  const [gs] = await sql<{ id: string }[]>`
    INSERT INTO institutions (name, source) VALUES ('Goldman Sachs', 'csv') RETURNING id`;

  const [checking] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, external_id, mask)
    VALUES (${chase.id}, 'Chase Total Checking', 'depository', 'simplefin', 'chk-1', '4432')
    RETURNING id`;
  const [explorer] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, external_id, mask)
    VALUES (${chase.id}, 'Chase United Explorer', 'credit', 'simplefin', 'exp-1', '9911')
    RETURNING id`;
  const [apple] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, mask)
    VALUES (${gs.id}, 'Apple Card', 'credit', 'csv', '0007')
    RETURNING id`;
  const [brokerage] = await sql<{ id: string }[]>`
    INSERT INTO accounts (name, type, source, mask)
    VALUES ('Morgan Stanley Brokerage', 'investment', 'manual', '1234')
    RETURNING id`;

  return {
    checkingId: checking.id,
    explorerId: explorer.id,
    appleId: apple.id,
    brokerageId: brokerage.id,
  };
}

export async function categoryByName(sql: postgres.Sql, name: string): Promise<string> {
  const [c] = await sql<{ id: string }[]>`SELECT id FROM categories WHERE name = ${name} LIMIT 1`;
  if (!c) throw new Error(`No category named ${name}`);
  return c.id;
}
