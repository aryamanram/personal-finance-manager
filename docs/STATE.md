# Decisions and state

Two kinds of thing live here, and they age differently.

**Most of this file is decisions** — why Venmo out is spending, why ATM cash has
its own category, why 2024–2026 cannot anchor a budget. Those do not go stale.
They are the things you would otherwise re-explain at the start of every session,
and the reason they are written down is that re-deriving them wastes time and
sometimes gets a different answer.

**One section is volatile** (Right now, below). A state doc that nobody updates
is worse than none, because it gets believed. So that section is kept short
enough that being out of date is obvious, and it carries the date it was last
touched.

`CLAUDE.md` says *how* to work here. This says *what has been settled*.

> **If you change an answer below, change it in the same commit.**

---

## Right now · last updated 2026-09-17

Nothing blocking. Everything merged to `main`; tests green.

Two standing tasks the owner tracks:

- Record a Morgan Stanley balance monthly, so performance has a period to
  measure over.
- Add a payroll rule once McKinsey deposits start, so income categorises itself.

---

## Where the project got to

All seven milestones from `docs/DESIGN.md` are done and accepted against their
own checks. The app runs against live bank accounts, not fixtures.

| | |
|---|---|
| Transactions | ~383, Sept 2024 → present, 100% categorised |
| Accounts | Chase checking, United Explorer, Apple Card (all SimpleFIN), Morgan Stanley (manual snapshots) |
| Reconciliation | Clean, except a rolling few dollars for charges the bank has not settled into its own balance yet |
| Tests | 126 |

## What is connected

**SimpleFIN** pulls all three card/bank accounts daily. The setup token is
minted from "Connect an App" in the bridge dashboard — not from account
settings, which is where people look first. Rate limit is ~24 requests/day and
**exceeding it disables the token**; `sync` detects the warning and says to stop.

**Claude Haiku** categorises unknown merchants, batched per merchant so each is
decided once. Optional: without `ANTHROPIC_API_KEY` the step is skipped and
unknown merchants stay `Uncategorized`.

**Morgan Stanley** is snapshot-tracked by hand. Opening position recorded
2026-09-16 at $207,227.41. Needs a second reading before Modified Dietz has a
period to measure — one snapshot is a starting line, and the page says so rather
than printing a meaningless 0.00%.

## Decisions worth not relitigating

**Peer-payment rails.** Venmo `PAYMENT` out is spending; Venmo `CASHOUT` in is a
transfer. Zelle to an individual has consistently been splitting a food bill.
PayPal `INST XFER` was paying down a PayPal Credit line for a Magic: the
Gathering purchase, categorised by what the money *bought* rather than the rail
it travelled.

**The LLM reliably gets those rails wrong**, routing them to `Account Transfer`
— mechanically defensible, wrong for a spending ledger, and it once hid $5,048.
Those rails are claimed by explicit rules so the model cannot re-decide them. If
it ever touches them again, clear `merchants.default_category_id` too, or the
mistake becomes permanent.

**ATM cash** goes to `Cash Withdrawn`, not `Uncategorized`. It *is* an
expenditure — it left the account — but its destination is unknowable.
`Uncategorized` means "nobody has decided yet"; conflating the two makes the
backlog count meaningless.

**Income history is thin and that is correct.** McKinsey starting 2026-09-25 is
the first real full-time job; before that, mostly unpaid internships and a
six-week Perficient stint. 2024–2025 has no salary baseline at all, so those
years cannot anchor a budget. **2027 is the first year with full data.** Do not
read 2024–2026 as a trend or propose a budget from it.

## Known and deliberate

- **`db:pull`** exists but Drizzle introspection is unused; `db/schema.sql` is
  hand-written and authoritative.
- **`budgets` and `holdings` tables are empty.** Both are in the schema for
  later, per `docs/DESIGN.md` §13. Leave them.
- **Transaction splitting is out of scope** — one transaction, one category.
- **No auth.** Runs on localhost or behind Tailscale. Adding a second user means
  revisiting every query in `src/lib/queries.ts`.
- **`@mermaid-js/mermaid-cli` is a devDependency** and pulls Puppeteer. That is
  the cost of `npm run check:diagrams` working offline and reproducibly.

## Open questions

Flagged rather than guessed at, per `docs/DESIGN.md` §12:

- **Annual fee amortisation.** The Explorer's fee spikes one month's fixed
  costs. Shown as-is today; spreading it over twelve months is a view change now
  and a data migration later.
- **LLM proposing new categories.** Currently it may only pick from the existing
  list. Allowing proposals means deciding who curates the taxonomy.
- **Reconciliation surfacing.** A passive banner today. Fine while drift is
  explainable; revisit if it starts firing for reasons nobody chases.

## Where things live

```
db/schema.sql          authoritative DDL
docs/DESIGN.md         the spec, invariants I1–I8
docs/INGEST_NOTES.md   dedup, supersession, transfer matching
docs/architecture/     four diagrams, system context → module detail
docs/STATE.md          this file
private/my-rules.ts    real categorisation rules — gitignored
src/money.ts           the only cents↔display path
src/lib/queries.ts     every read, through v_transactions
src/lib/edit.ts        every manual write, plus the audit log
```
