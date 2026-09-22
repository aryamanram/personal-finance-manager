# Decisions and state

Two kinds of thing live here, and they age differently.

**Most of this file is decisions** — why a peer-payment rail counts as spending,
why withdrawn cash gets its own category, why a partial year cannot anchor a
budget. Those do not go stale. They are what you would otherwise re-explain at
the start of every session, and re-deriving them wastes time and sometimes
reaches a different answer.

**One section is volatile** (Right now, below). A state doc nobody updates is
worse than none, because it gets believed. So that section is kept short enough
that being out of date is obvious, and it carries the date it was last touched.

`CLAUDE.md` says *how* to work here. This says *what has been settled*.

> **If you change an answer below, change it in the same commit.**

**This file is public.** Balances, account names, employers, merchants, and
transaction counts belong in `private/STATE.local.md`, which is gitignored.
Describe the *shape* of a decision here and keep the specifics there.

---

## Right now · last updated 2026-09-17

Nothing blocking. Everything merged to `main`; tests green.

Two standing tasks the owner tracks — details in `private/STATE.local.md`:

- Record a brokerage balance monthly, so investment performance has a period to
  measure over. One snapshot is a starting line, not a return.
- Add a payroll rule when a new income source starts, so it categorises itself.

Next up: design work on the look and feel, using the Figma integration.

---

## Where the project got to

All seven milestones from `docs/DESIGN.md` are done and accepted against their
own checks. The app runs against live bank accounts, not fixtures: several
hundred transactions spanning about two years, fully categorised, reconciling
against the banks' own balances.

Connected: two card/bank feeds through SimpleFIN on a daily pull, one
snapshot-tracked brokerage, and Claude Haiku for unknown merchants.

## Decisions worth not relitigating

**Product-level detail cannot come from the rails.** MCC is assigned per
merchant, not per product, so it can reach "hobby shop" and never "which
product". Level 3 data does carry SKUs but exists only on corporate cards and
flows merchant to acquirer, never back to the cardholder. A live probe of the
SimpleFIN bridge found `mcc` present in the response and **empty on every
transaction**, so do not vendor an MCC lookup table for a column that is always
null. Item detail is therefore a human field, and the design brief is to make
entering it fast rather than rare. See `docs/CATEGORIZATION.md`.

**The same probe found `payee` populated on every transaction** — a
bank-normalized merchant name, shorter than the raw descriptor on every sampled
row, absent from our type definition and dropped on every sync. It is a better
merchant key than matching a descriptor that drifts with formatting.

**Half the money is in merchants seen exactly once.** 125 of 175 merchants
appear a single time, and those rows carry 46% of all spending. Merchant memory
only ever covers the recurring half, so any design premised on "the system
learns your habits" misses half the ledger by construction.

**LLM correctness is structural, not statistical.** Confidence is a poor
filter here: the model sits at >=0.90 on half the ledger and below 0.70 on only
7.6%, and the peer-payment misrouting was almost certainly high-confidence and
wrong. What makes the model safe is that its rows are never `category_locked`,
so deterministic passes overwrite them and the register shows them as guesses.
Use confidence to prioritise review, never to assert correctness.

**Peer-payment rails.** Money going *out* through Venmo, Zelle, or PayPal is
spending; a cash-*out* back to checking is a transfer. The direction is the
signal, not the rail. Where such a payment funded a purchase on credit, it is
categorised by what the money *bought*, not by the rail it travelled.

**The LLM reliably gets those rails wrong**, routing them to `Account Transfer`
— mechanically defensible, since money does move through a rail, but wrong for a
spending ledger. That category carries `necessity='transfer'`, so anything
landing there leaves the totals entirely. It once hid several thousand dollars of
real spending. Those rails are now claimed by explicit rules so the model cannot
re-decide them each run. If it ever touches them again, clear
`merchants.default_category_id` too, or the mistake becomes permanent.

**Withdrawn cash** goes to `Cash Withdrawn`, not `Uncategorized`. It *is* an
expenditure — it left the account — but its destination is unknowable.
`Uncategorized` means "nobody has decided yet"; conflating the two makes the
backlog count meaningless.

**Income history is thin, and that is correct, not a gap.** The owner's first
full-time job starts late 2026; before that, mostly unpaid internships and one
short contract. The early years have no salary baseline at all, so they cannot
anchor a budget. **The first year with full data is 2027.** Do not read the
earlier months as a trend, and do not propose a budget from them.

**One snapshot is not a return.** An investment account with a single balance
reading has no period to measure over. The page says tracking starts here rather
than printing a meaningless 0.00%, and Modified Dietz only becomes meaningful at
the second reading.

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

- **Annual fee amortisation.** A card's annual fee spikes one month's fixed
  costs. Shown as-is today; spreading it over twelve months is a view change now
  and a data migration later.
- **LLM proposing new categories.** Currently it may only pick from the existing
  list. Allowing proposals means deciding who curates the taxonomy.
- **Reconciliation surfacing.** A passive banner today. Fine while drift is
  explainable; revisit if it starts firing for reasons nobody chases.

## Where things live

```
db/schema.sql            authoritative DDL
docs/DESIGN.md           the spec, invariants I1–I8
docs/INGEST_NOTES.md     dedup, supersession, transfer matching
docs/architecture/       four diagrams, system context → module detail
docs/STATE.md            this file — public, no personal specifics
private/STATE.local.md   the same picture with real numbers — gitignored
private/my-rules.ts      real categorisation rules — gitignored
src/money.ts             the only cents↔display path
src/lib/queries.ts       every read, through v_transactions
src/lib/edit.ts          every manual write, plus the audit log
```
