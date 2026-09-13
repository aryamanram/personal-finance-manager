/**
 * The SimpleFIN sync pass (DESIGN.md §6, M3).
 *
 * Idempotent: running it twice over the same window inserts nothing the second
 * time. Writes a sync_runs row on every path including failure, so a silently
 * broken cron job is visible rather than looking like "no spending this week".
 */
import type { Sql } from 'postgres';
import {
  fetchAccounts, toCanonical, collectErrors, institutionName,
  type SimpleFinAccount, type SimpleFinConnection,
} from './simplefin';
import { upsertTransactions } from './upsert';
import { parseCents } from '../money';
import type { AccountType } from '../lib/types';

/** Overlap re-fetched on every sync to catch late-posting transactions. */
const OVERLAP_DAYS = 5;
/** SimpleFIN's maximum lookback on a first run. */
const FIRST_RUN_DAYS = 90;

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

export async function runSync(
  sql: Sql,
  opts: { accessUrl: string; since?: Date; log?: (msg: string) => void } = {
    accessUrl: '',
  },
): Promise<SyncResult> {
  const log = opts.log ?? (() => {});
  const start = opts.since ?? (await windowStart(sql));

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
    windowStart: start.toISOString().slice(0, 10),
  };

  try {
    log(`· fetching from ${result.windowStart}`);
    const set = await fetchAccounts(opts.accessUrl, { startDate: start, pending: true });

    // Protocol checklist: display error messages from /accounts to the user.
    // A con.auth error means one institution is broken while others still work,
    // which is a partial sync, not a failure.
    for (const err of collectErrors(set)) {
      const label = err.code ? `[${err.code}] ` : '';
      result.errors.push(`${label}${err.msg}`);
      log(`  ! ${label}${err.msg}`);
    }

    for (const sfAccount of set.accounts) {
      const { id: accountId, created } = await resolveAccount(sql, sfAccount, set.connections ?? []);
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
