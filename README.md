# Ledger

A self-hosted expense tracker for one person. Reads transactions from Chase via
SimpleFIN and from an Apple Card CSV export, categorizes them, and answers two
questions:

1. **How much can I actually invest?** — income minus required spending.
2. **How much of next month do I already know?** — fixed versus variable costs.

Single user, runs on localhost or behind Tailscale. No authentication.

## Privacy

This repository holds the code for a financial tracker, never the finances.
Clone it and you get an empty shell: no transactions, no balances, no
credentials. Everything personal lives in your local Postgres and in files git
refuses to track.

`.gitignore` blocks `*.csv`, `*.ofx`, `*.qfx`, `*.qbo`, `*.pdf`, every `.env*`
file except `.env.example`, `/data/`, `/private/`, and `db/dumps/`. The only
tracked CSVs are two synthetic fixtures, **unignored by name** rather than by
unignoring the directory — a blanket `!fixtures/**/*.csv` would silently commit
a real statement dropped there while debugging an import.

Two things that are personal but not obviously so:

- **Categorization rules** name your employer, your landlord and the shops you
  use. Keep them in `private/my-rules.ts`; `scripts/rules.example.ts` is the
  template.
- **`SIMPLEFIN_ACCESS_URL` is a bearer credential in URL form.** It lives only
  in `.env.local`. `redactUrl()` is the only form allowed near a log line, and
  no error in the sync path interpolates it — there is a test for that.

### Before you push

```bash
npm run check:privacy
```

Fails on a tracked env file, an unrecognised CSV, anything shaped like an API
key or a credentialed URL, and on any commit in *history* that touched an env or
private path — deleting a file does not remove it from earlier commits.

Install it as a pre-push hook (hooks are not cloned, so each checkout needs
this once):

```bash
printf '#!/bin/sh\nexec npx tsx scripts/check-privacy.ts\n' > .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

## Who can reach it

There is no login, so the network boundary is the access control.

- **Postgres** publishes on `127.0.0.1:5433` only. Its starting password is in
  this public repo, so it must never be reachable from another machine — and a
  real ledger should leave it once: `npm run db:rotate-password` sets a random
  one on the role and in `.env.local` together, proving it before saving.
- **The app** binds to `127.0.0.1` — `npm run dev` and `npm run start` pass
  `-H`. Next's own default is every interface, which puts an unauthenticated
  ledger on whatever Wi-Fi you are sitting on.
- **`src/proxy.ts`** refuses a request whose `Host` is not one the ledger
  answers to (DNS rebinding) and a state-changing request a browser sends from
  another site (cross-site request forgery). Without it, any page you visit
  could read or edit the ledger through your own browser.

To use it from another device, put a reverse proxy in front instead of
widening the bind — `tailscale serve 3000`, say — and name the host it serves
on in `.env.local`:

```bash
LEDGER_ALLOWED_HOSTS=your-machine.your-tailnet.ts.net
```

Nothing about a transaction leaves the machine except SimpleFIN's read-only
pull, and the browser fetches nothing from anywhere but the app — fonts are
self-hosted. Categorisation is local and deterministic; `tests/no-network.test.ts`
fails if an LLM client, an LLM API host, an outbound request, or a third-party
URL in a page appears.

## Setup

```bash
npm install
docker compose up -d          # Postgres 16 on :5433
cp .env.example .env.local
npm run db:apply              # applies db/schema.sql
npm run seed                  # ~230 synthetic transactions to develop against
npm run dev                   # http://localhost:3000
```

`npm run seed` gives you six months of invented data covering every case the UI
has to render: transfer pairs, a voided duplicate, a pending transaction, a
manually overridden category, an edited amount, and brokerage snapshots. Develop
against this rather than against your own statements.

### Connecting Chase

1. Link your institutions in the bridge dashboard first — the token grants
   access to whatever is already connected, so a token minted before you add
   Chase will sync an empty account list.
2. Visit **https://beta-bridge.simplefin.org/simplefin/create** to mint a setup
   token. It is generated on demand and is *not* stored in your account
   settings, which is why it is easy to look for and not find.
3. Exchange it:

```bash
npx tsx scripts/claim-simplefin.ts <setup-token>
# Paste the printed line into .env.local, then:
npm run sync
```

Setup tokens are single-use. A 403 means it was already claimed — per the
SimpleFIN protocol checklist that may mean it was compromised, so revoke it at
the bridge rather than retrying.

**Rate limit: about 24 requests per day.** The bridge starts emitting warnings
above that and **disables the access token** if they are ignored, which means
re-claiming a setup token. A daily cron is well inside the limit, but running
`npm run sync` repeatedly while testing is not. `sync` detects the warning and
says so loudly; stop for the day when it does. Quotas replenish through the day.

The request window is capped at 90 days, and each sync overlaps the previous one
by 5 days to catch late-posting transactions.

### Importing an Apple Card statement

Wallet → Apple Card → card balance → the monthly statement → Export
Transactions. Drop the CSV on the Accounts page. You get a preview — row count,
date range, computed total, and whether the sign convention was flipped — and
**nothing is written until you confirm.**

Re-importing the same statement, or a later statement that overlaps it, is
safe. Duplicates are counted rather than re-inserted.

### Your own categorization rules

Rule patterns name your employer, your landlord, and the places you shop — that
is personal data and does not belong in a public repo. So the real rules live in
`private/`, which is gitignored:

```bash
cp scripts/rules.example.ts private/my-rules.ts
# edit to match your merchants
npx tsx private/my-rules.ts && npm run recategorize
```

To find what still needs a rule, the register's "Uncategorized" filter or:

```sql
SELECT raw_description, count(*) FROM v_transactions
WHERE category_name = 'Uncategorized' GROUP BY 1 ORDER BY 2 DESC;
```

### Clearing the demo data

`npm run seed` writes ~230 fake transactions. Once you have synced real ones:

```bash
npx tsx scripts/purge-demo.ts --dry-run   # show what would go
npx tsx scripts/purge-demo.ts             # remove seed, keep everything real
```

Seed accounts carry a `demo-` external id, which is what makes this safe to run
against a database that already holds real transactions.

## Daily operation

```bash
npm run sync                        # fetch, categorize, match transfers
npm run recategorize -- --from 2026-01-01   # after editing rules
npx tsx scripts/match-transfers.ts  # review pairs the matcher was unsure about
npm test
```

Pairs scoring below 0.90 are listed rather than linked, because a wrong link
removes two real transactions from spending. Confirm one with:

```bash
npx tsx scripts/match-transfers.ts --link <id-a> <id-b>
```

There is no in-process scheduler. On a Mac, schedule the sync once a day with
launchd — at midnight, or at the first login after a day the Mac missed:

```bash
npm run sync:schedule -- install --dry-run   # rehearse: the job only checks
npm run sync:schedule -- install             # then for real
npm run sync:schedule -- status              # last run and the log tail
```

The job fires at midnight and at every login, and syncs only if no sync has
succeeded since the last midnight — one run by hand counts. So a Mac asleep at
midnight syncs on waking, one that was off syncs at the next login, and a login
on a day already done does nothing, not even start Docker. Nothing is lost
across a missed day, because every sync re-fetches from five days before the
last good one. The job starts Docker if it is not running and never retries
within a run — the bridge disables a token that keeps exceeding its daily
limit. A normal day is one SimpleFIN request. Catching up more than 45 days
— a long time off, or a new account's backfill — is one request per 45-day
window, and a rate-limit warning stops the sync before the remaining windows;
the backfill is not marked done, so the next run picks it up again. Elsewhere,
cron can run the sync itself, but
it starts nothing: the database must already be up, or that night fails and
the next run catches up. Its bare `PATH` will not find npm either, so give the
full path (`which npm`):

```cron
0 0 * * * cd /path/to/ledger && /usr/local/bin/npm run sync >> sync.log 2>&1
```

Exit codes: `0` ok, `1` failed, `2` partial (one institution is broken, others
synced), `3` misconfigured, `4` another sync was already running and this one
did nothing.

## Design work

Design, screenshot and test against a synthetic ledger, never your own.
Screenshots, Figma pushes, visual-test baselines and published pages all leave
the machine — some into this public repo.

```bash
npm run demo:setup   # (re)create finance_demo beside the real database, seeded
npm run dev:demo     # the app on http://127.0.0.1:3001, reading finance_demo
npm run demo:reseed  # back to the seeded state, keeping the schema
```

The demo database lives in the same Postgres as the real one, under its own
name, and is rebuilt from `scripts/seed-demo.ts` every time — pinned to a
fixed date, so it renders identically run to run. The demo app builds into
`.next-demo/` on port 3001, so it runs alongside `npm run dev` (which is
pinned to :3000 — unpinned, Next would fall back to :3001 when :3000 is
busy, and the real ledger would sit where the design tools expect the demo).

`demo:setup` drops and re-applies the schema, which leaves a running
`dev:demo` holding stale type OIDs — restart it afterwards. `demo:reseed`
only truncates and refills, so it is safe with the server up.

### Visual and accessibility tests

```bash
npm run test:visual          # every page, desktop and phone, against its baseline
npm run test:visual:update   # accept the current rendering as the new baseline
npm run test:a11y            # axe, WCAG 2.1 A and AA
```

Playwright starts `dev:demo` (or reuses one already running), reseeds the
demo, and refuses to run unless :3001 is showing the synthetic ledger.
Baselines live in `tests/visual/__screenshots__/`, per platform, and are
committed — they are pictures of invented data, never the real ledger. A
failed comparison leaves the expected, actual and diff images in
`test-results/`; `npx playwright show-report` shows them side by side.

`test:a11y` holds the violations axe finds today in a list in
`tests/visual/a11y.spec.ts`. The comparison is exact: a new violation fails,
and so does fixing a listed one until its line is deleted.

Neither suite is part of `prepush`. During a redesign the baselines are
meant to change; run them deliberately, look at the diffs, then update.

### Agent tooling

`.mcp.json` gives Claude Code three MCP servers (approve them on first start):

| Server | For |
|---|---|
| `playwright` | Headless screenshots at exact viewport sizes; accessibility snapshots |
| `next-devtools` | The running dev server's build and runtime errors, routes and logs |
| `chrome-devtools` | Performance traces, layout and CSS inspection |

Each is pinned to an exact version — bump them deliberately — runs headless
with a throwaway browser profile, and has its usage telemetry switched off.

They can only see the demo. Next serves its `/_next/mcp` endpoint from
`npm run dev:demo` alone (`experimental.mcpServer` in `next.config.mjs`), so
`next-devtools` finds nothing on :3000. Chrome DevTools blocks :3000 at the
network layer, redirects included (`--blockedUrlPattern`). Playwright's
filter does not see a server's redirects, so it allows :3001 and nothing
else (`--allowed-origins`) — and the app never redirects, so no page it can
load leads to :3000. These guard against a wrong port or a stray redirect;
they are not a sandbox against an agent that also has a shell.

For a human view of several screen sizes at once, Responsively App (free),
Polypane or Sizzy.

## How it is put together

**[Architecture diagrams](docs/architecture/)** — four levels, from a one-screen
system context down to module detail and the path one transaction takes. Start
there if you are new, or when a number looks wrong.

```
db/schema.sql          authoritative DDL — edit this, not migrations
src/ingest/            fingerprint, dedup, SimpleFIN, Apple Card CSV
src/categorize/        income sources → rules → guess from history → Uncategorized
src/transfers/         pair matching
src/money.ts           the only cents↔display path
src/lib/edit.ts        the manual edit contract
src/app/               dashboard, register, accounts
docs/architecture/     the diagrams, four levels of zoom
docs/DESIGN.md         the design document
docs/INGEST_NOTES.md   the dedup, supersession, and matching algorithms
```

Ingest, categorization, and transfer matching are three separate idempotent
passes. Each can be re-run over any date range without corrupting state — that
separation is what makes "tweak a rule, re-run the categorizer" the development
loop.

## The invariants

These are the things that, if broken, make the ledger untrustworthy. Each has a
test; `npm test` is the check.

| | |
|---|---|
| **I1** | Money is integer cents everywhere. `parseCents` scales through string manipulation, so `0.29` never passes through a float. |
| **I2** | Raw source values are immutable. Corrections go in `*_override` columns; `amount_cents` still holds what the bank said, which is what makes reconciliation possible. |
| **I3** | All reads go through `v_transactions` and use `eff_*`. No `COALESCE` resolution in application code. |
| **I4** | Machine passes never overwrite human decisions. Every batch query carries `NOT category_locked`, and the categorizer re-counts locked rows afterward and throws if the count fell. |
| **I5** | Nothing is hard-deleted. Duplicates are voided, because deleting a row just means the next import re-inserts it. |
| **I6** | Every manual edit writes a `transaction_edits` row — the audit trail and the basis for undo. |
| **I7** | Re-importing the same file is a no-op. |
| **I8** | A hand-imported CSV row and a later synced row for the same transaction resolve to one row via fingerprint adoption. |

Two of these are easy to get wrong in ways nothing reports:

- **A too-broad categorization rule can erase a bill.** `Credit Card Payment`
  carries `necessity = 'transfer'`, so a rule matching `/AUTOPAY/` that catches
  `CITY UTILITIES AUTOPAY` does not merely miscategorize the bill — it removes
  it from spending entirely. Name the card in transfer rules.
- **`normalize()` is load-bearing.** Changing it invalidates every stored
  fingerprint, and the next import will double-count. If you change it,
  re-fingerprint the whole table in the same migration.

## Two axes, not one

`cost_type` asks *is this predictable?* `necessity` asks *can I cut it?* They
cross independently:

| | required | discretionary |
|---|---|---|
| **fixed** | rent, insurance | Netflix, gym |
| **variable** | groceries, gas | restaurants, travel |

The investable number comes off the necessity axis. Forecasting confidence comes
off the cost axis. One toggle would lose one of those questions.

## Investment accounts

Contributions are transactions on checking with `necessity = 'investment'`.
Account *value* lives in `balance_snapshots` and never reaches the cashflow view
— a 6% month is not a paycheck.

Return is Modified Dietz, which weights each contribution by the fraction of the
period it was invested. On the seeded data it reports 3.44% where a naive
`(end − start) / start` would report 18.59% by counting deposits as gains.

## Open questions

Flagged rather than guessed at, per `docs/DESIGN.md` §12:

- **Annual fee amortization.** The Explorer's fee spikes one month's fixed
  costs. Show as-is, or spread over twelve months? Currently as-is.
