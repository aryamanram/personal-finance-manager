/**
 * GET /api/demo is what the visual tests trust before photographing a page
 * for a public repo. It must say nothing on the real app, and under dev:demo
 * it must report the database its connection actually reached — not a name
 * it was told.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/db';

let db: Awaited<ReturnType<typeof createTestDb>>;
let GET: () => Promise<Response>;
const saved = { url: process.env.DATABASE_URL, demo: process.env.LEDGER_DEMO };

beforeAll(async () => {
  db = await createTestDb('demo_attest');
  // lib/db builds its pool from DATABASE_URL at import time.
  process.env.DATABASE_URL = db.url;
  ({ GET } = await import('@/app/api/demo/route'));
});

afterAll(async () => {
  process.env.DATABASE_URL = saved.url;
  if (saved.demo === undefined) delete process.env.LEDGER_DEMO;
  else process.env.LEDGER_DEMO = saved.demo;
  await db.drop();
});

describe('GET /api/demo', () => {
  it('is a 404 unless the server was started by dev:demo', async () => {
    delete process.env.LEDGER_DEMO;
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  it('under dev:demo, names the database its own connection reached', async () => {
    process.env.LEDGER_DEMO = '1';
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ database: new URL(db.url).pathname.slice(1) });
  });
});
