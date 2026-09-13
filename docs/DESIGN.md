# Personal Finance Tracker — POC Design Doc

**Audience:** Claude Code, building a proof of concept.
**Owner:** Aryaman. Single user. Self-hosted. Not a product, not multi-tenant.
**Companion files:** `schema.sql` (authoritative data model), `README.md` (ingest algorithms).

---

## 1. What this is

A self-hosted Monarch-style expense tracker for one person. Reads transactions
from Chase via SimpleFIN and from an Apple Card CSV export, categorizes them,
and renders cashflow visualizations that answer two questions:

1. **How much can I actually invest?** — income minus required spending.
2. **How much of next month do I already know?** — fixed vs variable costs.

### Accounts in scope

| Account | Institution | Ingest | Notes |
|---|---|---|---|
| Chase Total Checking | Chase | SimpleFIN, daily | Primary. Payroll in, rent out. |
| Chase United Explorer | Chase | SimpleFIN, daily | Annual fee lands as one lumpy fixed charge. |
| Apple Card | Goldman Sachs | Manual CSV, monthly | No API aggregation exists. Apple purchases only; discretionary. Subscriptions here are fixed. |
| Morgan Stanley Brokerage | Morgan Stanley | Manual balance snapshot, monthly | Value tracked via `balance_snapshots` only. See §13. |

### In scope for the POC

- SimpleFIN sync for the two Chase accounts
- Apple Card CSV import (drag-and-drop, re-import safe)
- Rule-based categorization + LLM fallback for unknown merchants
- Full manual edit of any transaction: category, amount, date, description, cost type, necessity, void
- Transfer detection and exclusion from spend
- Three views: monthly cashflow, category breakdown, transaction list

### Explicitly out of scope

- Authentication (runs on localhost or behind Tailscale)
- Multi-user, multi-currency, holdings-level position tracking
- Mobile app, PWA, or responsive polish beyond "usable on a laptop"
- Budgets UI (the `budgets` table exists; leave the screen for later)
- Transaction splitting (one txn across multiple categories) — deferred, do not build

---

## 2. Non-negotiable invariants

These are the things that, if broken, make the whole system untrustworthy.
Every PR should be checkable against this list.

**I1 — Money is integer cents, everywhere.** `BIGINT` in Postgres, `number` of
cents in TS. No floats, no `parseFloat` on a currency string without an
explicit cents conversion. Format to dollars only at the render boundary.

**I2 — Raw source values are immutable.** `transactions.amount_cents`,
`posted_date`, and `raw_description` are written once at ingest and never
updated. User corrections go in `amount_cents_override` / `posted_date_override`
/ `description`. This is what preserves the ability to reconcile against the
bank's own balance.

**I3 — Read effective values through the view.** All reporting and all UI reads
go through `v_transactions` and use `eff_amount_cents`, `eff_posted_date`,
`eff_description`, `eff_cost_type`, `eff_necessity`. Never resolve `COALESCE`
logic in application code — it will drift between call sites. The only code
allowed to read `transactions.amount_cents` directly is the reconciliation check
and the fingerprint calculation.

**I4 — Machine passes never overwrite human decisions.** Every batch
categorization query carries `AND NOT category_locked`. Setting
`category_source = 'manual'` sets the lock via database trigger; do not try to
manage the flag from application code.

**I5 — Nothing is hard-deleted.** Duplicates and misreads are voided
(`voided_at`, `void_reason`), not removed. Deleting a row means the next import
happily re-inserts it.

**I6 — Every manual edit writes a `transaction_edits` row.** Field name, old
value, new value. This is the audit trail and the basis for undo.

**I8 — CSV backfill and API sync must not double-count.** A hand-imported CSV
row and a later synced row describing the same transaction must resolve to one
row via fingerprint adoption, not two. See §1 of `README.md`.

**I7 — Re-importing the same file is a no-op.** See the counting-dedup
algorithm in `README.md`. Test this explicitly — import the same CSV twice and
assert the transaction count is unchanged.

---

## 3. Architecture

```
┌─────────────────┐     ┌──────────────────┐
│  SimpleFIN API  │     │ Apple Card CSV   │
│  (Chase, daily) │     │ (manual upload)  │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         ▼                       ▼
   ┌───────────────────────────────────┐
   │  Ingest layer                     │
   │  normalize → fingerprint → dedup  │
   │  → supersede pending              │
   └────────────────┬──────────────────┘
                    ▼
   ┌───────────────────────────────────┐
   │  Categorization pipeline          │
   │  1. merchant default              │
   │  2. rules (priority order)        │
   │  3. LLM fallback (cached/merchant)│
   │  ALL skip category_locked rows    │
   └────────────────┬──────────────────┘
                    ▼
   ┌───────────────────────────────────┐
   │  Transfer matcher                 │
   └────────────────┬──────────────────┘
                    ▼
              ┌───────────┐
              │ Postgres  │
              │ v_transactions │
              └─────┬─────┘
                    ▼
         Next.js app (read + edit)
```

Ingest, categorization, and transfer matching are three separate idempotent
passes. Each can be re-run independently over any date range without corrupting
state. Do not fuse them into one function — the ability to re-run just the
categorizer after tweaking rules is the main development loop.

---

## 4. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 22, TypeScript strict | — |
| Framework | Next.js 15, App Router | Server components read Postgres directly; no separate API tier needed |
| DB | Postgres 16 | Local Docker for dev; a free managed tier or the same container in prod |
| DB access | Drizzle ORM, schema introspected from `schema.sql` | `schema.sql` stays the source of truth. Run `drizzle-kit pull`. Do not let Drizzle generate migrations that fight the hand-written DDL. |
| Validation | Zod | Every edit endpoint validates input before write |
| Styling | Tailwind + shadcn/ui | Fast, and matches the Monarch visual register |
| Charts | Recharts for bar/line/area; `d3-sankey` + custom SVG for the Sankey | Recharts' Sankey is too limited for the income→category flow |
| Client state | TanStack Query | Optimistic updates on edits (see §7) |
| Scheduling | A `pnpm sync` script invoked by system cron | No in-process scheduler; keep sync runnable by hand |
| LLM | Anthropic SDK, Claude Haiku | Categorization only. Cheapest model that does the job. |

**Do not add:** an auth library, Redis, a queue, tRPC, or a state manager beyond
TanStack Query. Single user, single machine.

---

## 5. Repo layout

```
finance/
├─ db/
│  ├─ schema.sql              # authoritative DDL — edit this, not migrations
│  ├─ migrations/             # numbered, forward-only, generated by hand
│  └─ drizzle/                # introspected types, gitignored + regenerated
├─ src/
│  ├─ ingest/
│  │  ├─ simplefin.ts         # fetch + map to canonical shape
│  │  ├─ applecard-csv.ts     # parse + sign detection
│  │  ├─ fingerprint.ts       # normalize() + sha256
│  │  └─ upsert.ts            # counting dedup, pending supersession
│  ├─ categorize/
│  │  ├─ rules.ts
│  │  ├─ llm.ts               # merchant-level, cached
│  │  └─ run.ts               # orchestrates; enforces I4
│  ├─ transfers/match.ts
│  ├─ money.ts                # cents<->display, the ONLY formatting path
│  └─ app/
│     ├─ page.tsx             # cashflow dashboard
│     ├─ transactions/        # list + inline edit
│     └─ api/transactions/[id]/route.ts   # PATCH endpoint
├─ scripts/
│  ├─ sync.ts
│  └─ recategorize.ts         # re-run categorizer over a date range
└─ tests/
```

---

## 6. Ingest

### SimpleFIN

Credentials: a one-time setup token exchanged for an access URL. Store the
access URL in `.env.local` as `SIMPLEFIN_ACCESS_URL`. It is a bearer credential
in URL form — never log it, never commit it.

Fetch window: `start-date` = 5 days before the last successful `sync_runs` row,
to catch late-posting transactions. First run: 90 days (SimpleFIN's max).

Every run writes a `sync_runs` row with counts and status, even on failure.

### Apple Card CSV

Export path for the user: Wallet → Apple Card → card balance → tap the monthly
statement → Export Transactions → CSV.

Columns are `Date, Type, Description, Daily Cash (%), Daily Cash ($), Amount`.
Two things to handle:

1. **Sign detection.** Do not assume negative-for-outflow. On parse, inspect the
   `Type` column: rows typed as payments or credits have opposite sign to
   purchases. Assert that the majority of `Transactions`-typed rows come out
   negative after conversion; if not, flip and log a warning. Write a unit test
   with a fixture for both conventions.
2. **Daily Cash rows.** Cashback appears as its own row. Route it to a
   `Daily Cash` category with `necessity = 'discretionary'` so it nets against
   spending. It must not land in income — otherwise monthly income creeps
   upward by a few dollars forever.

Upload UI: a drop zone that shows a parsed preview table before committing,
with the row count, date range, and computed total. The user confirms, then it
writes. Never write on drop.

---

## 7. The manual edit contract

This is the part the user cares most about, so spell it out.

**Editable fields:** `category_id`, `amount_cents_override`,
`posted_date_override`, `description`, `cost_type_override`,
`necessity_override`, `merchant_id`, `notes`, `voided_at` + `void_reason`,
`exclude_from_totals`, and transfer link/unlink.

**Endpoint:** `PATCH /api/transactions/[id]` taking a partial object, Zod
validated.

On write it must:
1. Insert one `transaction_edits` row per changed field.
2. Set `category_source = 'manual'` when `category_id` changed (the trigger then
   sets `category_locked`).
3. Return the full refreshed row **from `v_transactions`**, not from the base
   table — the client needs resolved `eff_*` values.

**Frontend behavior:** optimistic update via TanStack Query, then reconcile with
the returned row. Invalidate the cashflow and category-breakdown queries on
success so the charts move immediately — the user's stated requirement is that
an edit updates "in system as well as frontend", and a stale chart after an edit
is the failure mode to avoid.

**Visual affordance:** any transaction where `is_amount_or_date_edited` is true
renders with a small marker and the original value available on hover. Edited
data that looks identical to synced data is how you lose trust in your own
ledger.

**Undo:** a per-transaction history panel reading `transaction_edits`, with a
revert action that nulls the override and logs the revert as another edit.

---

## 8. Categorization pipeline

Order, each step skipping rows where `category_locked = true`:

1. **Merchant default.** If `merchants.default_category_id` is set, use it.
   Highest precedence because it encodes a past human decision.
2. **Rules.** Evaluate `rules` by ascending `priority`, first match wins.
3. **LLM fallback.** For rows still uncategorized, batch the distinct
   *normalized merchant names* (not transactions) and ask Claude Haiku to pick
   from the category list. Write the result to `merchants.default_category_id`
   so the same merchant is never sent twice. Set `category_source = 'llm'` and
   record `suggested_confidence`.
4. Anything left lands in `Uncategorized` with `category_source = 'default'`.

Always populate `suggested_category_id` even when a lock prevents applying it —
it's the signal for finding rules worth writing.

`scripts/recategorize.ts --from 2026-01-01` re-runs steps 2–4 over a range. It
must be safe to run any number of times.

---

## 9. Frontend views

**Dashboard (`/`)**
- Header cards: income, required, discretionary, spendable — current month, with
  MoM delta.
- Sankey: income → required / discretionary / investment → top categories. This
  is the Monarch view the whole project is for; give it the most attention.
- Stacked bar, 12 months, fixed vs variable.
- "Uncategorized: N" call to action linking to a filtered transaction list.

**Transactions (`/transactions`)**
- Virtualized table, filters on date range, account, category, necessity.
- Inline edit on click: category via combobox, amount via a cents-aware input.
- Bulk select → set category (respecting nothing; bulk edits are manual edits and
  set the lock).
- Voided rows shown struck through, not hidden, with a filter toggle.

**Category detail (`/categories/[id]`)**
- Monthly trend, transaction list, and the fixed/variable + required/discretionary
  defaults editable inline.

---

## 10. Build order

Each milestone is independently verifiable. Do not start the next until the
acceptance check passes.

**M1 — Database + types.** Apply `schema.sql`, introspect with Drizzle, wire a
connection.
*Accept:* `schema.sql` applies clean to an empty DB; `v_monthly_cashflow`
returns zero rows without error.

**M2 — Apple Card CSV import.** Parser, fingerprint, counting dedup, preview UI.
*Accept:* importing a fixture CSV twice yields the same row count as importing
once. Sign detection test passes on both conventions.

**M3 — SimpleFIN sync.** Fetch, map, upsert, pending supersession, `sync_runs`.
*Accept:* two consecutive syncs insert no duplicates. A pending row that posts
carries its category forward.

**M4 — Categorization.** Rules, merchant defaults, LLM fallback.
*Accept:* re-running the categorizer does not change any row where
`category_locked = true`. Write this as an actual test, not a manual check.

**M5 — Transfer matching.**
*Accept:* a checking→Explorer payment pair is linked and
`counts_as_spending = false` on both legs.

**M6 — Transaction list + edit.** PATCH endpoint, optimistic UI, edit log, undo.
*Accept:* editing an amount changes the dashboard totals without a page reload,
and `transactions.amount_cents` is unchanged in the database.

**M7 — Dashboard.** Header cards, Sankey, fixed/variable bar chart.
*Accept:* numbers on the dashboard match a hand-written SQL query against
`v_monthly_cashflow`.

---

## 11. Seed and fixtures

Ship a `scripts/seed-demo.ts` that generates ~6 months of synthetic transactions
across the three accounts, including: a payroll deposit, rent, two card payment
transfer pairs, a duplicate needing voiding, a pending→posted pair, and at least
one transaction whose category has been manually overridden. Develop the UI
against this rather than against real financial data.

---

## 13. Investment accounts

The brokerage account is modelled on a **different axis** from spending, and
conflating the two is the main risk here.

- **Contributions** are transactions on Chase checking with
  `necessity = 'investment'`. They leave the spendable pool and appear in
  `invested_cents`. This is the number that answers "am I actually investing
  what I said I would?"
- **Account value** lives in `balance_snapshots`, one row per month. Market
  movement is neither income nor spending and must never reach
  `v_monthly_cashflow`. A 6% month is not a paycheck.

`v_net_worth` resolves the two: accounts with snapshots use the latest snapshot,
everything else uses its running transaction total.

### The expandable contribution row

In the transaction list, a contribution renders as a normal outflow — "Morgan
Stanley ACH, $2,000, Investment". Expanding it opens a panel backed by
`v_investment_performance`:

```
  Sent to investment          $4,000    (sum of linked contributions)
  Starting position          $80,000    (first snapshot — predates tracking)
  Worth now                  $87,200    (latest snapshot)
  ─────────────────────────────────
  Market gain                 $3,200
  Return                        3.90%   (Modified Dietz)
```

Three things this gets right, all of which are easy to get wrong:

1. **The opening balance is not a gain.** Money in the account before tracking
   began (past work, gifts) is a starting position. Growth is measured from the
   first snapshot, never from zero.
2. **Contributions are not performance.** A naive `(end − start) / start` on the
   numbers above returns 9%, because it counts the $4,000 you deposited as
   investment return. Modified Dietz weights each contribution by the fraction
   of the period it was invested and returns 3.90%. Use the view; do not
   recompute this in TypeScript.
3. **The identity must hold.** `opening + contributed + gain = current`. Assert
   it in a test — if it drifts, a contribution lost its `destination_account_id`.

Link contributions by setting `transactions.destination_account_id` to the
brokerage. This is deliberately *not* a transfer pair: the brokerage has no
transaction rows, so there's no second leg, and the contribution correctly stays
in the ledger as an outflow with `necessity = 'investment'`.

For the POC: a manual "update balance" input on the account page, one number per
month. Do not build holdings-level tracking, cost basis, or performance
attribution. The `holdings` table exists in the schema for later; leave it empty.

Before building the manual path, check whether Morgan Stanley is listed at
`beta-bridge.simplefin.org/search-institutions`. SimpleFIN does return investment
accounts with a `holdings` array (symbol, shares, cost_basis, market_value) for
supported brokerages, and if MS is covered it costs nothing extra on the
subscription already being paid for Chase.

---

## 12. Open decisions

Flag these to the user rather than guessing:

- **Annual fee amortization.** The Explorer's annual fee spikes one month's fixed
  costs. Show as-is, or spread across twelve months in the cashflow view?
  Decide before M7; it's a view change now and a data migration later.
- **Reconciliation surfacing.** When the sum of a Chase account's transactions
  diverges from `accounts.balance_cents`, what happens? Suggest a passive banner
  rather than a blocking error.
- **LLM category list growth.** Should the LLM be allowed to propose new
  categories, or only pick from existing ones? Default to picking only.
