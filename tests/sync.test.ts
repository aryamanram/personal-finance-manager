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
import { runSync, inferAccountType, splitWindows } from '@/ingest/sync';
import { redactUrl, epochToIsoDate, toCanonical, isRateLimitWarning } from '@/ingest/simplefin';
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

describe('window splitting', () => {
  const day = 24 * 60 * 60 * 1000;

  it('returns one window for a routine daily sync', () => {
    const end = new Date('2026-09-16T12:00:00Z');
    const start = new Date(end.getTime() - 5 * day);
    expect(splitWindows(start, end, 45)).toHaveLength(1);
  });

  it('splits a 89-day backfill into windows within the recommended range', () => {
    const end = new Date('2026-09-16T12:00:00Z');
    const start = new Date(end.getTime() - 89 * day);
    const windows = splitWindows(start, end, 45);

    expect(windows.length).toBeGreaterThan(1);
    // No window may exceed the limit — that warning is what this exists to avoid.
    for (const [from, to] of windows) {
      expect(to.getTime() - from.getTime()).toBeLessThanOrEqual(45 * day);
    }
    // Contiguous and complete: no gap can silently drop transactions.
    expect(windows[0]![0].getTime()).toBe(start.getTime());
    expect(windows[windows.length - 1]![1].getTime()).toBe(end.getTime());
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]![0].getTime()).toBe(windows[i - 1]![1].getTime());
    }
  });

  it('never returns zero windows', () => {
    const t = new Date('2026-09-16T12:00:00Z');
    expect(splitWindows(t, t, 45).length).toBeGreaterThanOrEqual(1);
  });
});

describe('bridge request contract', () => {
  it('asks for protocol version 2 explicitly', async () => {
    const spy = vi.fn(async (_input: unknown) =>
      new Response(JSON.stringify(baseSet([])), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    await runSync(sql, { accessUrl: ACCESS_URL });

    const requested = new URL(String(spy.mock.calls[0]![0]));
    // Without this the bridge may answer with the v1 shape (a per-account `org`
    // object instead of a top-level `connections` array).
    expect(requested.searchParams.get('version')).toBe('2');
    expect(requested.searchParams.get('pending')).toBe('1');
    expect(requested.searchParams.get('start-date')).toBeTruthy();
  });

  it('sends credentials as a Basic header, never in the URL', async () => {
    const spy = vi.fn(async (_input: unknown, _init?: unknown) =>
      new Response(JSON.stringify(baseSet([])), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    await runSync(sql, { accessUrl: ACCESS_URL });

    // Node's fetch throws "Request cannot be constructed from a URL that
    // includes credentials", and a SimpleFIN access URL is credentials-in-URL
    // by design — so every real sync fails unless they are moved to a header.
    const requested = new URL(String(spy.mock.calls[0]![0]));
    expect(requested.username).toBe('');
    expect(requested.password).toBe('');
    expect(String(spy.mock.calls[0]![0])).not.toContain('secret');

    const init = spy.mock.calls[0]![1] as { headers: Record<string, string> };
    const auth = init.headers.Authorization;
    expect(auth).toMatch(/^Basic /);
    expect(Buffer.from(auth.slice(6), 'base64').toString()).toBe('user:secret');
  });

  it('flags a rate-limit warning — the token gets DISABLED if ignored', async () => {
    expect(isRateLimitWarning({ msg: 'Rate limit exceeded for this token' })).toBe(true);
    expect(isRateLimitWarning({ msg: 'Slow down, too many requests' })).toBe(true);
    expect(isRateLimitWarning({ msg: 'Authentication failed for Chase' })).toBe(false);

    mockFetch({
      errlist: [{ code: 'gen.', msg: 'Warning: rate limit approaching for this access token' }],
      connections: [{ conn_id: 'CON-1', name: 'Chase' }],
      accounts: [checkingAccount([])],
    });

    const r = await runSync(sql, { accessUrl: ACCESS_URL });
    expect(r.rateLimited).toBe(true);
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
    // Scoped to the runs this describe block made — earlier blocks in this file
    // also sync, so an unqualified count couples unrelated tests together.
    const runs = await sql<{ status: string; txns_inserted: number }[]>`
      SELECT status, txns_inserted FROM sync_runs
      WHERE txns_inserted > 0 OR status = 'ok'
      ORDER BY started_at`;
    expect(runs.length).toBeGreaterThanOrEqual(2);

    const inserting = runs.find((r) => r.txns_inserted === 3);
    expect(inserting).toBeDefined();
    expect(inserting!.status).toBe('ok');

    // The follow-up run found the same three transactions and inserted none.
    expect(runs.some((r) => r.txns_inserted === 0 && r.status === 'ok')).toBe(true);
  });
});

describe('an account connected after the first sync gets a full backfill', () => {
  it('does not leave a newly discovered account empty', async () => {
    // By this point the suite has already run successful syncs, so the window
    // is incremental (a few days). A second institution connected now — which
    // is the normal case: Chase and the Apple Card are linked at different
    // times — must still get its history, not just the overlap window.
    const epochDaysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return Math.floor(d.getTime() / 1000);
    };

    const lateAccount: SimpleFinAccount = {
      id: 'sf-late-1',
      name: 'Apple Card',
      currency: 'USD',
      balance: '-707.21',
      'balance-date': epochDaysAgo(0),
      conn_id: 'CON-2',
      transactions: [
        // All older than the incremental window; only a backfill reaches them.
        { id: 'sf-late-a', posted: epochDaysAgo(60), amount: '-274.52', description: 'APPLE STORE #R035' },
        { id: 'sf-late-b', posted: epochDaysAgo(45), amount: '-162.80', description: 'APPLE.COM/US' },
        { id: 'sf-late-c', posted: epochDaysAgo(30), amount: '54.51', description: 'ACH Deposit Internet transfer' },
      ],
    };

    mockFetch({
      errlist: [],
      connections: [
        { conn_id: 'CON-1', name: 'Chase' },
        { conn_id: 'CON-2', name: 'Apple Card (Updated Monthly)' },
      ],
      accounts: [checkingAccount([]), lateAccount],
    });

    const r = await runSync(sql, { accessUrl: ACCESS_URL });

    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.external_id = 'sf-late-1'`;

    // Before the fix this was 0: the account appeared with its balance, the run
    // reported "ok", and every one of its transactions was silently missed.
    expect(c).toBe(3);
    expect(r.inserted).toBeGreaterThanOrEqual(3);
  });

  it('stops backfilling once the account has history', async () => {
    mockFetch({
      errlist: [],
      connections: [{ conn_id: 'CON-1', name: 'Chase' }],
      accounts: [checkingAccount([])],
    });

    const spy = vi.fn(async (_i: unknown) =>
      new Response(JSON.stringify(baseSet([])), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    await runSync(sql, { accessUrl: ACCESS_URL });

    // Every account now has rows, so this is a routine incremental sync: one
    // window, not the multi-window backfill.
    expect(spy.mock.calls.length).toBe(1);
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
