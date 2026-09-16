/**
 * SimpleFIN client (DESIGN.md §6).
 *
 * Protocol reference: https://www.simplefin.org/protocol.html (v2.0.0-draft).
 * Written against both shapes: v1 returns an `org` object per account, v2
 * returns a top-level `connections` array keyed by `conn_id`.
 *
 * SECURITY: the access URL embeds Basic Auth credentials. It is a bearer
 * credential in URL form. Never log it, never put it in an error message,
 * never persist it anywhere but .env.local. redactUrl() below is the only
 * form allowed to reach a log line.
 */
import type { CanonicalTxn, TxnStatus } from '../lib/types';
import { parseCents } from '../money';

export interface SimpleFinTransaction {
  id: string;
  posted: number;              // UNIX epoch; may be 0 while pending
  amount: string;              // numeric string; positive = deposit
  description: string;
  transacted_at?: number;
  pending?: boolean;
  extra?: Record<string, unknown>;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  transactions?: SimpleFinTransaction[];
  holdings?: SimpleFinHolding[];
  conn_id?: string;                                  // v2
  org?: { id?: string; name?: string; domain?: string; 'sfin-url'?: string };  // v1
  extra?: Record<string, unknown>;
}

export interface SimpleFinHolding {
  id?: string;
  created?: number;
  cost_basis?: string;
  currency?: string;
  description?: string;
  market_value?: string;
  purchase_price?: string;
  shares?: string;
  symbol?: string;
}

export interface SimpleFinConnection {
  conn_id: string;
  name?: string;
  org_id?: string;
  org_url?: string;
  sfin_url?: string;
}

export interface SimpleFinError {
  code?: string;
  msg: string;
  conn_id?: string;
  account_id?: string;
}

export interface AccountSet {
  errlist?: SimpleFinError[];
  errors?: string[];            // v1, deprecated
  connections?: SimpleFinConnection[];
  accounts: SimpleFinAccount[];
}

/** Strips Basic Auth credentials so a URL can appear in a log or an error. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '***';
    }
    return u.toString();
  } catch {
    return '<unparseable url>';
  }
}

export class SimpleFinError_ extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SimpleFinError';
  }
}

/**
 * Exchanges a one-time setup token for a durable access URL.
 * Run once, then store the result in .env.local as SIMPLEFIN_ACCESS_URL.
 *
 * A 403 means the token was already claimed — per the protocol checklist, that
 * may mean it was compromised, so the user should revoke it at the bridge.
 */
export async function claimAccessUrl(setupToken: string): Promise<string> {
  const claimUrl = Buffer.from(setupToken.trim(), 'base64').toString('utf8');
  if (!claimUrl.startsWith('https://')) {
    throw new SimpleFinError_('Decoded setup token is not an HTTPS URL. Is the token correct?');
  }

  const res = await fetch(claimUrl, { method: 'POST' });
  if (res.status === 403) {
    throw new SimpleFinError_(
      'Claim rejected (403): this token was already claimed. If you did not claim it, ' +
      'treat it as compromised and revoke it at the SimpleFIN bridge.',
      403,
    );
  }
  if (!res.ok) {
    throw new SimpleFinError_(`Claim failed: HTTP ${res.status}`, res.status);
  }

  const accessUrl = (await res.text()).trim();
  if (!accessUrl.startsWith('https://')) {
    throw new SimpleFinError_('Bridge did not return an HTTPS access URL.');
  }
  return accessUrl;
}

export interface FetchOptions {
  /** Inclusive lower bound. Transactions posted before this are not returned. */
  startDate?: Date;
  endDate?: Date;
  /** Include not-yet-posted transactions. We want these — see supersession. */
  pending?: boolean;
  /** Skip transactions entirely; balances only. */
  balancesOnly?: boolean;
  accountIds?: string[];
}

/** Fetches and validates a SimpleFIN account set for the requested window. */
export async function fetchAccounts(
  accessUrl: string,
  opts: FetchOptions = {},
): Promise<AccountSet> {
  if (!accessUrl.startsWith('https://')) {
    // Protocol checklist: only ever make requests to TLS URLs.
    throw new SimpleFinError_('SIMPLEFIN_ACCESS_URL must be an https:// URL.');
  }

  const url = new URL(`${accessUrl.replace(/\/$/, '')}/accounts`);
  // The bridge's own examples pass this explicitly. Without it the server may
  // answer with the v1 shape (an `org` object per account instead of a
  // top-level `connections` array), which institutionName() would then fail to
  // resolve.
  url.searchParams.set('version', '2');
  if (opts.startDate) {
    url.searchParams.set('start-date', String(Math.floor(opts.startDate.getTime() / 1000)));
  }
  if (opts.endDate) {
    url.searchParams.set('end-date', String(Math.floor(opts.endDate.getTime() / 1000)));
  }
  if (opts.pending) url.searchParams.set('pending', '1');
  if (opts.balancesOnly) url.searchParams.set('balances-only', '1');
  for (const id of opts.accountIds ?? []) url.searchParams.append('account', id);

  // Node's fetch REFUSES a URL carrying credentials ("Request cannot be
  // constructed from a URL that includes credentials"), and a SimpleFIN access
  // URL is credentials-in-URL by design. Strip them off the URL and send them
  // as the Basic auth header they already represent.
  const headers: Record<string, string> = { Accept: 'application/json' };
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (username || password) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    url.username = '';
    url.password = '';
  }

  const res = await fetch(url, { headers });

  if (res.status === 403) {
    throw new SimpleFinError_(
      'SimpleFIN returned 403. The access URL is invalid or was revoked; re-claim a setup token.',
      403,
    );
  }
  if (!res.ok) {
    // Deliberately does not include the URL — it carries credentials.
    throw new SimpleFinError_(`SimpleFIN request failed: HTTP ${res.status}`, res.status);
  }

  const body = (await res.json()) as AccountSet;
  if (!Array.isArray(body.accounts)) {
    throw new SimpleFinError_('Malformed response: no accounts array.');
  }
  return body;
}

/**
 * The bridge expects <= 24 requests/day and DISABLES the access token if you
 * keep exceeding it after the warnings start. Warnings arrive in the normal
 * error list, so they must be surfaced rather than swallowed.
 */
export function isRateLimitWarning(err: SimpleFinError): boolean {
  return /rate limit|too many requests|quota|slow down/i.test(err.msg);
}

/** Normalizes v1 `errors` strings and v2 `errlist` objects into one list. */
export function collectErrors(set: AccountSet): SimpleFinError[] {
  const out: SimpleFinError[] = [...(set.errlist ?? [])];
  for (const msg of set.errors ?? []) {
    if (!out.some((e) => e.msg === msg)) out.push({ msg });
  }
  return out;
}

/** UNIX epoch (seconds) to an ISO yyyy-mm-dd in local time. */
export function epochToIsoDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Map SimpleFIN transactions to the canonical shape.
 *
 * `posted` is 0 while a transaction is pending, per the protocol. Fall back to
 * transacted_at, then to today — a date of 1970-01-01 would silently land the
 * row outside every reporting window.
 */
export function toCanonical(
  account: SimpleFinAccount,
  accountId: string,
  txns: SimpleFinTransaction[] = account.transactions ?? [],
): CanonicalTxn[] {
  const out: CanonicalTxn[] = [];

  for (const t of txns) {
    const isPending = t.pending === true;
    const postedEpoch = t.posted && t.posted > 0 ? t.posted : t.transacted_at;
    const postedDate = postedEpoch
      ? epochToIsoDate(postedEpoch)
      : epochToIsoDate(Math.floor(Date.now() / 1000));

    let amountCents: number;
    try {
      amountCents = parseCents(t.amount);
    } catch {
      continue;  // a malformed amount is skipped, not guessed at
    }
    // The schema forbids zero-amount rows (CONSTRAINT amount_nonzero).
    if (amountCents === 0) continue;

    out.push({
      accountId,
      amountCents,
      postedDate,
      authorizedDate: t.transacted_at ? epochToIsoDate(t.transacted_at) : null,
      status: (isPending ? 'pending' : 'posted') as TxnStatus,
      rawDescription: t.description || '(no description)',
      externalId: t.id,
      source: 'simplefin',
      currency: account.currency?.length === 3 ? account.currency : 'USD',
    });
  }

  return out;
}

/** Institution name for an account, across both protocol versions. */
export function institutionName(
  account: SimpleFinAccount,
  connections: SimpleFinConnection[] = [],
): string {
  if (account.conn_id) {
    const conn = connections.find((c) => c.conn_id === account.conn_id);
    if (conn?.name) return conn.name;
  }
  return account.org?.name ?? account.org?.domain ?? 'Unknown institution';
}
