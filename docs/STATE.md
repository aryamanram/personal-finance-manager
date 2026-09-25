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

## Right now · last updated 2026-09-25

Nothing blocking. The register rebuild is merged (PR #11); everything is on
`main` and the full gate is green there.

**One branch is open and unmerged: `categorization-design`.** It is a spec —
`docs/CATEGORIZATION.md`, the layer under DESIGN.md §8 — and no code depends on
it. Its finding worth acting on: the SimpleFIN bridge populates `payee` on
every transaction and this ledger drops it on every sync, along with three
other signals. No feed carries product detail, so that is the ceiling on
automatic granularity. Merge it or act on it; do not let it rot unread.

CodeRabbit had not finished its review when the PR was merged, so that branch
went in unreviewed by it. Nothing was dismissed — it simply never reported.
Worth a glance over `src/components/CategoryFilter.tsx` and the ingest changes
in `src/ingest/upsert.ts` if a second opinion is wanted later.

The categorisation backlog is **cleared**: every transaction is hand-decided or
confirmed. That is the steady state the register was rebuilt for, and it means
the next machine pass has a locked baseline to respect rather than a mixed one.

Two things are half-done and will be obvious to the next person:

- **Categorisation rules live only in the example file.** The Venmo-by-sign,
  Toomics, and Entertainment patterns added this session are in
  `scripts/rules.example.ts` as illustrations. They are not active until
  copied into `private/my-rules.ts` and run. The `rules` table is empty.
- **The subcategory assignments were applied as one-off SQL**, not as rules.
  They hold, but a merchant that reappears under a new description will land on
  the parent until a rule covers it.

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

The cards carry their own proof: `getCardSettlement()` checks, per card, that
`purchases − payments_applied = still_owed = what the issuer reports`. While
that holds, counting card purchases as spending — and the payments that settle
them as transfers — is sound rather than assumed. It holds to the cent today.

## Decisions worth not relitigating

**Categories nest one level, no more.** (Moving one between parents is a single
`parent_id` update — done once already, for hobby goods.) `categories.parent_id`, with a trigger
refusing a third level and refusing a child in a different group from its
parent. A subcategory is an ORDINARY category — transactions point at exactly
one `category_id` — so rules, the model and the palette work on it unchanged,
and rolling up is a join rather than a second schema. `v_transactions` exposes
`rollup_category_*`, so anything wanting totals "as if the split never
happened" groups by those and is right without knowing the depth.

Arbitrary nesting was rejected because every rollup becomes a recursive CTE and
every screen has to choose a render depth. Promoting a category to a *group*
instead was rejected because it moves it out of its group and does not
generalise.

**Hobby goods are Shopping, not Entertainment.** `Games & Hobbies` sits under
Shopping. Entertainment is experiences and media — a ticket, a museum, a game
played; buying physical goods is retail, whatever the goods are for. That is
what Mint/MX, Yodlee and the YNAB convention all do, and it is the reading that
survives the edge cases: a board game bought and a concert attended are not the
same kind of spending just because both are fun.

It started under Entertainment and moved once it was the largest discretionary
line in the ledger. The move cost one `UPDATE` of `parent_id` and no data
migration, which is the payoff of subcategories being ordinary categories.

**Subscriptions are subcategorised by purpose, against the industry grain.**
No major taxonomy does this — Plaid, MX/Mint, Monarch and Yodlee all sort by
purpose and treat recurrence as a separate attribute, because a Subscriptions
category competes with Entertainment for the same transaction. That tension is
real and visible here (a game bought once vs. a game subscription). The parent
is still right for a one-person cancel-audit; if it ever bites, the fix is a
recurring-series flag, not more categories.

**The card's own leg of a card payment is not in the register.** A payment is
two rows for one event: a debit on checking and a credit on the card, where
positive means the debt went down. The debit proves the bill was paid; the
credit is the duplicate half. `v_transactions.is_card_payment_credit` marks it
STRUCTURALLY — positive, on a credit account, payment-shaped text — not by
category name, because some of those rows were filed as `Account Transfer`. A
refund is also positive on a card and is deliberately NOT caught: money coming
back is real, and hiding it would lose it.

**Green means income, not "positive number".** The two legs of a transfer carry
opposite signs, so a sign-based colour is necessarily wrong about one of them —
and it was wrong in the direction that made paying off a card look like
earning. Only `eff_necessity = 'income'` is green.

**A review chip counts only what the register can show.** These have drifted
twice — counts global while the table was period-scoped, then counting rows the
table now hides — each time leaving a backlog that could not reach zero. The
tests assert the *agreement* between count and filter, not either number.

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

**The row editor's scroll-into-view is approximate.** Opening a row near the
bottom of the register can leave the editor partly below the fold. Several
offset-based fixes were tried and abandoned; shortening the panel helped more
than any of them, and the remaining gap was not worth more tuning.

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
- **Reconciliation surfacing.** A passive banner today, and now quiet: it
  tests both bases (balances that include pending rows and balances that do
  not) and reports an account only when neither matches, so the cards no longer
  show phantom drift. One genuine checking difference remains, unexplained.
  Revisit if it starts firing for reasons nobody chases.
- **Payment rails inside Shopping.** A large share of Shopping is PayPal and
  Affirm rows, which name how something was paid rather than what was bought.
  Instalment plans are deliberately *not* their own category — the destination
  is what matters — so they sit unspecified until a human says where the money
  went. No automation will fix this; the descriptions do not carry it.
- **Sankey depth.** The diagram still shows top-level categories while the list
  under it shows subcategories. Expanding a band on click was chosen and not
  built.

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
