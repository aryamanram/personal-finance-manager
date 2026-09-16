/**
 * The SimpleFIN sync pass (DESIGN.md §6, M3).
 *
 * Idempotent: running it twice over the same window inserts nothing the second
 * time. Writes a sync_runs row on every path including failure, so a silently
 * broken cron job is visible rather than looking like "no spending this week".
 */
import type { Sql } from 'postgres';
import {
  fetchAccounts, toCanonical, collectErrors, institutionName, isRateLimitWarning,
  type SimpleFinAccount, type SimpleFinConnection, type AccountSet,
} from './simplefin';
import { upsertTransactions } from './upsert';
import { parseCents } from '../money';
import type { AccountType } from '../lib/types';

/** Overlap re-fetched on every sync to catch late-posting transactions. */
const OVERLAP_DAYS = 5;
/**
 * First-run lookback. 90 days is the bridge's hard cap on a single request.
 */
const FIRST_RUN_DAYS = 89;

/**
 * The bridge warns above 45 days ("exceeds recommended range ... this may be
 * capped") even though 90 is still accepted. Fetch a long first run as
 * successive windows of this size rather than one oversized request, so the
 * backfill keeps working when the recommendation becomes the limit.
 */
const MAX_WINDOW_DAYS = 45;

export interface SyncResult {
  syncRunId: string;
  status: 'ok' | 'partial' | 'failed';
  accountsSynced: number;
  inserted: number;
  updated: number;
  adopted: number;
  superseded: number;
  duplicate: number;
  /** Genuine problems: a connection failed, a balance would not parse. */
  errors: string[];
  /** Things worth telling the user that are NOT failures (a new account). */
  notices: string[];
  /**
   * The bridge disables an access token that keeps exceeding ~24 requests/day.
   * A warning here means STOP syncing, not retry.
   */
  rateLimited: boolean;
  windowStart: string;
}

/** Maps a SimpleFIN account to one of our account_type enum values. */
export function inferAccountType(account: SimpleFinAccount): AccountType {
  const name = account.name.toLowerCase();
  if (account.holdings?.length) return 'investment';
  if (/credit|card|visa|mastercard|amex|explorer/.test(name)) return 'credit';
  if (/brokerage|invest|ira|401k|roth/.test(name)) return 'investment';
  if (/loan|mortgage|student/.test(name)) return 'loan';
  if (/checking|savings|deposit|money market/.test(name)) return 'depository';

  // A negative balance on an unnamed account is much more likely a card than
  // a bank account, but don't guess past that.
  const balance = Number(account.balance);
  if (Number.isFinite(balance) && balance < 0) return 'credit';
  return 'depository';
}

/**
 * Resolves a SimpleFIN account to a local account row, creating it on first
 * sight. New accounts are created ACTIVE but the caller should surface them —
 * an unexpected account appearing changes every total.
 */
async function resolveAccount(
  sql: Sql,
  sfAccount: SimpleFinAccount,
  connections: SimpleFinConnection[],
): Promise<{ id: string; created: boolean }> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM accounts WHERE external_id = ${sfAccount.id} AND source = 'simplefin' LIMIT 1`;
  if (existing.length > 0) return { id: existing[0].id, created: false };

  const instName = institutionName(sfAccount, connections);
  const [inst] = await sql<{ id: string }[]>`
    WITH existing AS (
      SELECT id FROM institutions WHERE name = ${instName} AND source = 'simplefin' LIMIT 1
    ), inserted AS (
      INSERT INTO institutions (name, source)
      SELECT ${instName}, 'simplefin' WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    )
    SELECT id FROM existing UNION ALL SELECT id FROM inserted`;

  const [acct] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, external_id, currency)
    VALUES (${inst.id}, ${sfAccount.name}, ${inferAccountType(sfAccount)}, 'simplefin',
            ${sfAccount.id}, ${sfAccount.currency?.length === 3 ? sfAccount.currency : 'USD'})
    RETURNING id`;

  return { id: acct.id, created: true };
}

/** Start of the fetch window: OVERLAP_DAYS before the last successful sync. */
async function windowStart(sql: Sql): Promise<Date> {
  const [last] = await sql<{ started_at: Date }[]>`
    SELECT started_at FROM sync_runs
    WHERE source = 'simplefin' AND status IN ('ok', 'partial')
    ORDER BY started_at DESC LIMIT 1`;

  const from = new Date();
  from.setDate(from.getDate() - (last ? OVERLAP_DAYS : FIRST_RUN_DAYS));
  if (last) {
    const since = new Date(last.started_at);
    since.setDate(since.getDate() - OVERLAP_DAYS);
    return since;
  }
  return from;
}

/**
 * Which synced accounts have never completed a full backfill?
 *
 * The window above is global: once ONE successful sync exists, later runs fetch
 * only the last few days. An account connected after that first run therefore
 * arrives with its balance but none of its history, and nothing reports it —
 * the run says "ok" and inserts zero rows. Chase and the Apple Card are
 * connected at different times, and the Apple Card syncs monthly, so this is
 * the normal case rather than an edge case.
 *
 * Completion is recorded explicitly in accounts.backfilled_at rather than
 * inferred from "has no transactions". That inference had two failure modes:
 * an account with genuinely no activity re-ran the whole backfill on every
 * sync forever, and a backfill interrupted after its first window looked
 * finished — the account now had a row, so the next run used the incremental
 * window and the rest of its history was never fetched.
 */
async function unbackfilledAccounts(sql: Sql): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT a.name FROM accounts a
    WHERE a.source = 'simplefin' AND a.is_active AND a.backfilled_at IS NULL`;
  return rows.map((r) => r.name);
}

/**
 * Mark backfill complete. Called only after every window has been fetched AND
 * written, so an interrupted run leaves the flag unset and the next sync
 * resumes the full lookback.
 */
async function markBackfilled(sql: Sql, accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  await sql`
    UPDATE accounts SET backfilled_at = now(), updated_at = now()
    WHERE id = ANY(${accountIds}::uuid[]) AND backfilled_at IS NULL`;
}

/** Synchronizes SimpleFIN accounts, transactions, balances, and holdings. */

export async function runSync(
  sql: Sql,
  opts: { accessUrl: string; since?: Date; log?: (msg: string) => void } = {
    accessUrl: '',
  },
): Promise<SyncResult> {
  const log = opts.log ?? (() => {});

  let start = opts.since ?? (await windowStart(sql));

  // An account that has never completed a backfill needs its history, not the
  // last five days. Only widens the window; never narrows an explicit --since.
  //
  // `backfilling` records that this run's window IS a full lookback, which is
  // what licenses marking accounts complete at the end. It is also true on a
  // first run, where every account is new, and stays true for an account
  // discovered part-way through this same run.
  let backfilling = false;
  if (!opts.since) {
    const pending = await unbackfilledAccounts(sql);
    const backfill = new Date();
    backfill.setDate(backfill.getDate() - FIRST_RUN_DAYS);

    if (pending.length > 0 && backfill < start) {
      start = backfill;
      log(`· backfilling ${pending.length} account(s): ${pending.join(', ')}`);
    }

    // The run counts as a backfill whenever its window reaches the full
    // lookback — whether we widened it just now, or it already started there
    // because this is the first sync and windowStart returned FIRST_RUN_DAYS.
    // Comparing to the day rather than the millisecond: both dates are built
    // from `new Date()` moments apart, so an exact <= would be a coin flip.
    backfilling = start.getTime() <= backfill.getTime() + 60_000;
  }

  const [run] = await sql<{ id: string }[]>`
    INSERT INTO sync_runs (source, status) VALUES ('simplefin', 'running') RETURNING id`;

  const result: SyncResult = {
    syncRunId: run.id,
    status: 'ok',
    accountsSynced: 0,
    inserted: 0,
    updated: 0,
    adopted: 0,
    superseded: 0,
    duplicate: 0,
    errors: [],
    notices: [],
    rateLimited: false,
    windowStart: start.toISOString().slice(0, 10),
  };

  try {
    // Split the range into windows the bridge is happy with. A routine daily
    // sync is one window; only a first run or a long --since is more.
    const windows = splitWindows(start, new Date(), MAX_WINDOW_DAYS);
    log(`· fetching from ${result.windowStart}` +
        (windows.length > 1 ? ` in ${windows.length} windows` : ''));

    // Merge the windows into one account set. Transactions accumulate per
    // account; the balance from the newest window wins.
    const merged = new Map<string, SimpleFinAccount>();
    let connections: SimpleFinConnection[] = [];
    const seenErrors = new Set<string>();

    for (const [from, to] of windows) {
      const set = await fetchAccounts(opts.accessUrl, {
        startDate: from,
        endDate: to,
        pending: true,
      });
      connections = set.connections ?? connections;

      // Protocol checklist: display error messages from /accounts to the user.
      // A con.auth error means one institution is broken while others still
      // work, which is a partial sync, not a failure. Deduped across windows.
      for (const err of collectErrors(set)) {
        const label = err.code ? `[${err.code}] ` : '';
        const line = `${label}${err.msg}`;
        if (!seenErrors.has(line)) {
          seenErrors.add(line);
          result.errors.push(line);
          log(`  ! ${line}`);
        }
        if (isRateLimitWarning(err)) {
          result.rateLimited = true;
          log('  ! RATE LIMIT WARNING — stop syncing. Continuing past this will ' +
              'get the access token disabled and require re-claiming a setup token.');
        }
      }

      for (const account of set.accounts) {
        const existing = merged.get(account.id);
        if (!existing) {
          merged.set(account.id, { ...account, transactions: [...(account.transactions ?? [])] });
          continue;
        }
        // Later windows are newer, so their balance is the current one.
        existing.balance = account.balance;
        existing['balance-date'] = account['balance-date'];
        if (account.holdings?.length) existing.holdings = account.holdings;

        const seen = new Set(existing.transactions?.map((t) => t.id));
        for (const t of account.transactions ?? []) {
          if (!seen.has(t.id)) existing.transactions!.push(t);
        }
      }

      // A rate-limit warning mid-backfill means send no FURTHER request. The
      // response carrying the warning still holds real accounts and
      // transactions, and it has already cost a request against the quota, so
      // it is merged above before stopping. Breaking first threw it away.
      if (result.rateLimited) break;
    }

    const set: AccountSet = { accounts: Array.from(merged.values()), connections };

    const syncedAccountIds: string[] = [];

    for (const sfAccount of set.accounts) {
      const { id: accountId, created } = await resolveAccount(sql, sfAccount, set.connections ?? []);
      syncedAccountIds.push(accountId);
      if (created) {
        const msg = `New account discovered and created: "${sfAccount.name}"`;
        result.notices.push(msg);
        log(`  + ${msg}`);
      }

      const canonical = toCanonical(sfAccount, accountId);
      const up = await upsertTransactions(sql, canonical);

      result.inserted += up.inserted;
      result.updated += up.updated;
      result.adopted += up.adopted;
      result.superseded += up.superseded;
      result.duplicate += up.duplicate;
      result.accountsSynced++;

      // Cached balance: derived state. Transactions remain the truth (I2).
      try {
        await sql`
          UPDATE accounts
          SET balance_cents = ${parseCents(sfAccount.balance)},
              balance_as_of = to_timestamp(${sfAccount['balance-date']}),
              updated_at = now()
          WHERE id = ${accountId}`;
      } catch {
        result.errors.push(`Could not parse balance for "${sfAccount.name}".`);
      }

      // Investment accounts: record the value as a snapshot, never as income.
      if (sfAccount.holdings?.length || inferAccountType(sfAccount) === 'investment') {
        await recordSnapshot(sql, accountId, sfAccount);
      }

      log(`  · ${sfAccount.name}: +${up.inserted} new, ${up.updated} updated, ` +
          `${up.adopted} adopted, ${up.superseded} superseded`);
    }

    // Every window fetched and every account written: the backfill is complete.
    // Deliberately after the write loop, so an interruption anywhere above
    // leaves backfilled_at NULL and the next run starts the lookback again.
    if (backfilling && !result.rateLimited && syncedAccountIds.length > 0) {
      await markBackfilled(sql, syncedAccountIds);

      // An account the bridge no longer returns — revoked, closed, or dropped
      // from the connection — would otherwise stay unbackfilled forever and
      // force a full-lookback window on every future sync. Mark it complete
      // too: this run asked for the whole history and the bridge had nothing
      // to say about it. It is deactivated so the ledger records why.
      const stale = await sql<{ name: string }[]>`
        UPDATE accounts SET backfilled_at = now(), is_active = FALSE, updated_at = now()
        WHERE source = 'simplefin' AND is_active AND backfilled_at IS NULL
          AND id <> ALL(${syncedAccountIds}::uuid[])
        RETURNING name`;
      for (const a of stale) {
        const msg = `"${a.name}" was not returned by the bridge and has been deactivated.`;
        result.notices.push(msg);
        log(`  · ${msg}`);
      }
    }

    if (result.errors.length > 0 && result.accountsSynced > 0) result.status = 'partial';
    else if (result.accountsSynced === 0) result.status = 'failed';

    // Notices are recorded but never downgrade the status — discovering a new
    // account is normal, and a run that reports 'partial' every time trains the
    // user to ignore the field that means a bank connection is actually broken.
    const detail = [...result.errors, ...result.notices];

    await sql`
      UPDATE sync_runs SET
        status = ${result.status}, finished_at = now(),
        accounts_synced = ${result.accountsSynced},
        txns_inserted = ${result.inserted},
        txns_updated = ${result.updated + result.adopted},
        error = ${detail.length ? detail.join('; ') : null}
      WHERE id = ${run.id}`;

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.status = 'failed';
    result.errors.push(message);

    await sql`
      UPDATE sync_runs SET status = 'failed', finished_at = now(), error = ${message}
      WHERE id = ${run.id}`;

    throw err;
  }
}

/**
 * An investment account's VALUE is a snapshot, never a transaction
 * (DESIGN.md §13). A 6% month is not a paycheck.
 */
async function recordSnapshot(sql: Sql, accountId: string, sfAccount: SimpleFinAccount) {
  let balanceCents: number;
  try {
    balanceCents = parseCents(sfAccount.balance);
  } catch {
    return;
  }
  const asOf = new Date((sfAccount['balance-date'] ?? Date.now() / 1000) * 1000)
    .toISOString().slice(0, 10);

  await sql`
    INSERT INTO balance_snapshots (account_id, as_of, balance_cents, source)
    VALUES (${accountId}, ${asOf}, ${balanceCents}, 'simplefin')
    ON CONFLICT (account_id, as_of) DO UPDATE SET balance_cents = EXCLUDED.balance_cents`;

  for (const h of sfAccount.holdings ?? []) {
    if (!h.symbol) continue;
    await sql`
      INSERT INTO holdings (account_id, as_of, symbol, description, shares,
                            cost_basis_cents, market_value_cents, external_id)
      VALUES (${accountId}, ${asOf}, ${h.symbol}, ${h.description ?? null},
              ${h.shares ? Number(h.shares) : null},
              ${h.cost_basis ? safeCents(h.cost_basis) : null},
              ${h.market_value ? safeCents(h.market_value) : null},
              ${h.id ?? null})
      ON CONFLICT (account_id, as_of, symbol) DO UPDATE SET
        shares = EXCLUDED.shares,
        market_value_cents = EXCLUDED.market_value_cents`;
  }
}

function safeCents(v: string): number | null {
  try { return parseCents(v); } catch { return null; }
}


/**
 * Split [start, end] into consecutive windows of at most `days` each, oldest
 * first. Always returns at least one window.
 */
export function splitWindows(start: Date, end: Date, days: number): [Date, Date][] {
  const windows: [Date, Date][] = [];
  const span = days * 24 * 60 * 60 * 1000;

  let from = new Date(start);
  while (from < end) {
    const to = new Date(Math.min(from.getTime() + span, end.getTime()));
    windows.push([from, to]);
    if (to.getTime() >= end.getTime()) break;
    // Next window begins where this one ended; the bridge's range is
    // inclusive, and upsert dedups any transaction that lands in both.
    from = to;
  }

  return windows.length > 0 ? windows : [[start, end]];
}
