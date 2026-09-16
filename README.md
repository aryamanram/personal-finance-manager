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

Cron, since there is no in-process scheduler:

```cron
0 6 * * * cd /path/to/ledger && /usr/local/bin/npm run sync >> sync.log 2>&1
```

Exit codes: `0` ok, `1` failed, `2` partial (one institution is broken, others
synced), `3` misconfigured.

## How it is put together

**[Architecture diagrams](docs/architecture/)** — four levels, from a one-screen
system context down to module detail and the path one transaction takes. Start
there if you are new, or when a number looks wrong.

```
db/schema.sql          authoritative DDL — edit this, not migrations
src/ingest/            fingerprint, dedup, SimpleFIN, Apple Card CSV
src/categorize/        merchant defaults → rules → LLM → Uncategorized
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
- **LLM category proposals.** The model may only pick from the existing list.
  Currently no; changing it means deciding who curates the taxonomy.
