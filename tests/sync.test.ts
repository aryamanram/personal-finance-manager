/**
 * M3 acceptance: two consecutive syncs insert no duplicates, and a pending row
 * that posts carries its category forward.
 *
 * fetch is stubbed with a protocol-shaped AccountSet rather than hitting the
 * bridge, so this runs offline and deterministically.
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb, categoryByName } from './helpers/db';
import { runSync, inferAccountType } from '@/ingest/sync';
import { redactUrl, epochToIsoDate, toCanonical } from '@/ingest/simplefin';
import type { AccountSet, SimpleFinAccount } from '@/ingest/simplefin';

let sql: Sql;
let drop: () => Promise<void>;

const ACCESS_URL = 'https://user:secret@bridge.example.com/simplefin';

function epoch(iso: string): number {
  return Math.floor(new Date(`${iso}T12:00:00`).getTime() / 1000);
}

function mockFetch(set: AccountSet) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(set), {
    status: 200, headers: { 'content-type': 'application/json' },
  })));
}

const checkingAccount = (txns: SimpleFinAccount['transactions']): SimpleFinAccount => ({
  id: 'sf-chk-1',
  name: 'Chase Total Checking',
  currency: 'USD',
  balance: '4210.55',
  'balance-date': epoch('2026-08-31'),
  conn_id: 'CON-1',
  transactions: txns,
});

const baseSet = (txns: SimpleFinAccount['transactions']): AccountSet => ({
  errlist: [],
  connections: [{ conn_id: 'CON-1', name: 'Chase', org_id: 'INST-1' }],
  accounts: [checkingAccount(txns)],
});

beforeAll(async () => {
  const db = await createTestDb('sync');
  sql = db.sql;
  drop = db.drop;
}, 30_000);

afterAll(async () => { await drop(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('credential hygiene', () => {
  it('redacts Basic Auth before a URL can reach a log', () => {
    expect(redactUrl(ACCESS_URL)).toBe('https://***:***@bridge.example.com/simplefin');
    expect(redactUrl(ACCESS_URL)).not.toContain('secret');
  });
});

describe('M3 — two consecutive syncs insert no duplicates', () => {
  it('inserts on the first sync and nothing on the second', async () => {
    mockFetch(baseSet([
      { id: 'sf-t1', posted: epoch('2026-08-03'), amount: '-42.10', description: 'TRADER JOES 447' },
      { id: 'sf-t2', posted: epoch('2026-08-04'), amount: '2400.00', description: 'PAYROLL ACME CORP' },
      { id: 'sf-t3', posted: epoch('2026-08-05'), amount: '-9.99', description: 'NETFLIX.COM' },
    ]));

    const first = await runSync(sql, { accessUrl: ACCESS_URL });
    expect(first.status).toBe('ok');
    expect(first.inserted).toBe(3);
    expect(first.accountsSynced).toBe(1);

    const second = await runSync(sql, { accessUrl: ACCESS_URL });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(3);   // matched on external_id, updated in place

    const [{ c }] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM transactions`;
    expect(c).toBe(3);
  });

  it('creates the account on first sight and reuses it after', async () => {
    const [{ c }] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM accounts`;
    expect(c).toBe(1);
    const [acct] = await sql<{ name: string; type: string; balance_cents: number }[]>`
      SELECT name, type, balance_cents FROM accounts`;
    expect(acct.name).toBe('Chase Total Checking');
    expect(acct.type).toBe('depository');
    expect(acct.balance_cents).toBe(421055);
  });

  it('records every run in sync_runs, including the window', async () => {
    const runs = await sql<{ status: string; txns_inserted: number }[]>`
      SELECT status, txns_inserted FROM sync_runs ORDER BY started_at`;
    expect(runs).toHaveLength(2);
    expect(runs[0].status).toBe('ok');
    expect(runs[0].txns_inserted).toBe(3);
    expect(runs[1].txns_inserted).toBe(0);
  });
});

describe('M3 — a pending row that posts carries its category forward', () => {
  it('supersedes the pending leg and keeps the manual category', async () => {
    mockFetch(baseSet([
      { id: 'sf-p1', posted: 0, transacted_at: epoch('2026-08-20'),
        amount: '-64.00', description: 'THE LOCAL BISTRO', pending: true },
    ]));
    await runSync(sql, { accessUrl: ACCESS_URL });

    const [pending] = await sql<{ id: string; status: string; posted_date: string }[]>`
      SELECT id, status, posted_date FROM transactions WHERE external_id = 'sf-p1'`;
    expect(pending.status).toBe('pending');
    // posted = 0 must fall back to transacted_at, not become 1970-01-01.
    expect(String(pending.posted_date)).toContain('2026-08-20');

    const restaurants = await categoryByName(sql, 'Restaurants');
    await sql`
      UPDATE transactions SET category_id = ${restaurants}, category_source = 'manual'
      WHERE id = ${pending.id}`;

    // It posts two days later with a tip, under a new id.
    mockFetch(baseSet([
      { id: 'sf-posted-1', posted: epoch('2026-08-22'), amount: '-75.00',
        description: 'THE LOCAL BISTRO' },
    ]));
    const r = await runSync(sql, { accessUrl: ACCESS_URL });
    expect(r.superseded).toBe(1);

    const [posted] = await sql<{ category_id: string; category_locked: boolean }[]>`
      SELECT category_id, category_locked FROM transactions WHERE external_id = 'sf-posted-1'`;
    expect(posted.category_id).toBe(restaurants);
    expect(posted.category_locked).toBe(true);

    // The pending leg must not double-count in any view.
    const [v] = await sql<{ counts_as_spending: boolean }[]>`
      SELECT counts_as_spending FROM v_transactions WHERE id = ${pending.id}`;
    expect(v.counts_as_spending).toBe(false);
  });
});

describe('protocol error handling', () => {
  it('reports a connection error as partial, not a silent success', async () => {
    mockFetch({
      errlist: [{ code: 'con.auth', msg: 'Authentication failed for Chase', conn_id: 'CON-1' }],
      connections: [{ conn_id: 'CON-1', name: 'Chase' }],
      accounts: [checkingAccount([])],
    });

    const r = await runSync(sql, { accessUrl: ACCESS_URL });
    expect(r.status).toBe('partial');
    expect(r.errors.join(' ')).toMatch(/con\.auth/);

    const [run] = await sql<{ status: string; error: string }[]>`
      SELECT status, error FROM sync_runs ORDER BY started_at DESC LIMIT 1`;
    expect(run.status).toBe('partial');
    expect(run.error).toMatch(/Authentication failed/);
  });

  it('records a failed run rather than leaving it "running"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    await expect(runSync(sql, { accessUrl: ACCESS_URL })).rejects.toThrow(/403/);

    const [run] = await sql<{ status: string }[]>`
      SELECT status FROM sync_runs ORDER BY started_at DESC LIMIT 1`;
    expect(run.status).toBe('failed');
  });

  it('never puts the credentialed URL in an error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(runSync(sql, { accessUrl: ACCESS_URL })).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret') }),
    );
  });
});

describe('mapping', () => {
  it('converts epochs in local time', () => {
    expect(epochToIsoDate(epoch('2026-08-05'))).toBe('2026-08-05');
  });

  it('skips zero-amount rows the schema would reject', () => {
    const rows = toCanonical(checkingAccount([
      { id: 'z', posted: epoch('2026-08-01'), amount: '0.00', description: 'ZERO' },
      { id: 'ok', posted: epoch('2026-08-01'), amount: '-1.00', description: 'FINE' },
    ]), 'acct-uuid');
    expect(rows).toHaveLength(1);
    expect(rows[0].externalId).toBe('ok');
  });

  it('infers account type from name and holdings', () => {
    const base = { id: 'x', currency: 'USD', balance: '1.00', 'balance-date': 0 };
    expect(inferAccountType({ ...base, name: 'Chase United Explorer' })).toBe('credit');
    expect(inferAccountType({ ...base, name: 'Total Checking' })).toBe('depository');
    expect(inferAccountType({ ...base, name: 'Roth IRA' })).toBe('investment');
    expect(inferAccountType({ ...base, name: 'Mystery', holdings: [{ symbol: 'VTI' }] }))
      .toBe('investment');
    expect(inferAccountType({ ...base, name: 'Mystery', balance: '-500.00' })).toBe('credit');
  });
});
