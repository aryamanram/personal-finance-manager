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

## Right now · last updated 2026-10-07

**Nothing is in flight.** PRs #12–#17 are merged and `main` is green. The
ledger syncs itself daily (see the decisions below), was caught up on
2026-10-07, and the owner has confirmed every row the register shows — the
review backlog is empty. The card that syncs daily matches its issuer to the
cent. The employer's income source was re-registered by the text the bank
actually prints, checked against the real deposit with the app's own matcher.

**For whoever picks this up:**

- **Checking's reconciliation difference is real, not timing.** It predates
  this session, moved once on 2026-10-06, then held across later syncs — so a
  transaction the feed never delivered is the likely cause. Next step: export
  the checking statement as CSV and `npm run import -- <file> --account
  "<name>" --dry-run`, then for real. A statement overlapping the synced rows
  is safe — rows already present are counted, not inserted — so whatever the
  feed missed lands, and the gap closes or names itself. Import each file
  once: the CLI errors on an identical file it already imported (see Open
  questions), though it inserts nothing doing so.
- **One card's connection updates monthly.** SimpleFIN labels it "Updated
  Monthly", so its transactions trail its balance by up to a month. Its
  statement export was imported on 2026-10-07 — the overlap with synced rows
  deduplicated by fingerprint, as predicted beforehand — and it still reads
  as off by activity after the export's last row: the balance is newer than
  the file. Expect it to close when the next statement is imported or the
  feed catches up; if it does not, it is not timing.
- Tailscale access is deferred to the very end, by the owner's choice.

Standing tasks the owner tracks — details in `private/STATE.local.md`:

- Record a brokerage balance monthly, so investment performance has a period to
  measure over. One snapshot is a starting line, not a return.
- Register a new income source on the Accounts page when one starts — by the
  text the bank prints, then check the first deposit is filed as known.

---

## Where the project got to

All seven milestones from `docs/DESIGN.md` are done and accepted against their
own checks. The app runs against live bank accounts, not fixtures: several
hundred transactions spanning about two years, fully categorised, reconciling
against the banks' own balances.

Connected: checking and two cards through SimpleFIN on a daily pull (one card's
connection only updates monthly), and one snapshot-tracked brokerage.
Categorisation is local and deterministic.

The cards carry their own proof: `getCardSettlement()` checks, per card, that
`purchases − payments_applied = still_owed = what the issuer reports`. While
that holds, counting card purchases as spending — and the payments that settle
them as transfers — is sound rather than assumed. It holds to the cent for the
card that syncs daily; the monthly one trails until its statement lands.

## Decisions worth not relitigating

**Categorisation is deterministic, and a test keeps it that way.** The LLM
step, the Anthropic SDK and the API key are gone (PR #12); a guesser
(`src/categorize/guess.ts`) learns from the ledger's own human decisions
instead. Every guess is confirmed by hand regardless, which is exactly why
paying a model for them bought nothing. Measured with `npm run backtest`,
replaying the ledger's decisions:

| | exact category | precise when it guesses | guesses at all |
|---|---:|---:|---:|
| in date order (only earlier decisions known) | 79% | 94% | 84% |
| hold-out (every other decision known) | 87% | 96% | 91% |

Confidence tracks accuracy: the 0.8+ band is right ~97% of the time.
`tests/no-network.test.ts` fails on an LLM SDK (transitive included), an LLM
API host in code, any outbound request but SimpleFIN's, or a third-party URL
in a page — fonts are self-hosted for the same reason.

**Register an income source by the text the bank prints.** The employer was
registered by its name ahead of the first deposit, and the deposit did not
match: payroll arrives under an abbreviated legal name, and the feed masks
most of the ACH originator ID, so the ID is no fallback either. A source that
never matches files nothing and says nothing — the deposit just lands as a
payroll-pattern guess. So match on the printed text, and confirm the first
real deposit is filed as `income_source`.

**One sync a day, from this machine, one at a time.** launchd runs
`npm run sync` at midnight and at login, and each run syncs only if no sync
has *finished* `ok` or `partial` since the last midnight — one run by hand
counts; a failed one leaves the day open. Local,
because a cloud scheduler would cost money and need the database reachable
from outside. Never retried within a run, because the bridge disables a token
that keeps exceeding ~24 requests a day, and a missed day costs nothing:
every sync re-fetches from five days before the last good one. Every sync,
scheduled or by hand, takes one Postgres advisory lock in `runSync`, so two
can never both call the bridge.

**A hold the bank still lists merges only on exact amount and description.**
Some charges arrive with the authorization hold still listed beside the
posted charge, each under its own id, sync after sync. Supersession now
considers that hold, but strictly — the same amount and description — because
a pending row the bank is still listing could be a second purchase. The exact
match is tried before any loose one. INGEST_NOTES §2 has the rule.

**No separate least-privilege database role.** Declined by the owner: one
person, one machine, and small PRs matter more here than the isolation.

**No login; the network boundary is the access control.** One user, one
machine, so authentication would guard nothing a loopback bind does not —
provided the bind really is loopback, which Next's and Docker's defaults are
not. What loopback cannot stop is a web page in the owner's own browser, so
`src/proxy.ts` refuses any Host outside loopback and `LEDGER_ALLOWED_HOSTS`
(DNS rebinding) and any state-changing request a browser sends from another
origin (CSRF). Remote access goes through a reverse proxy such as
`tailscale serve`, never a wider bind.

**Categories nest one level, no more.** (Moving one between parents is a single
`parent_id` update — done once already, for hobby goods.) `categories.parent_id`, with a trigger
refusing a third level and refusing a child in a different group from its
parent. A subcategory is an ORDINARY category — transactions point at exactly
one `category_id` — so rules, the guesser and the palette work on it unchanged,
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

**The retired LLM reliably got those rails wrong**, routing them to `Account
Transfer` — mechanically defensible, since money does move through a rail, but
wrong for a spending ledger. That category carries `necessity='transfer'`, so
anything landing there leaves the totals entirely. It once hid several thousand
dollars of real spending, and it is part of why the model was retired. The
guesser reads rails by direction and by the owner's history: an outgoing
Zelle to a known person gets what that person was last paid for, an unknown
one gets what most outgoing Zelles were. Never `Account Transfer` unless the
owner filed that payee there.

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
- **No auth.** Runs on localhost or behind Tailscale, guarded by the loopback
  bind and `src/proxy.ts` (see the decision above). Adding a second user means
  revisiting every query in `src/lib/queries.ts`.
- **`@mermaid-js/mermaid-cli` is a devDependency** and pulls Puppeteer. That is
  the cost of `npm run check:diagrams` working offline and reproducibly.
- **The database password is not the compose default.** `POSTGRES_PASSWORD` in
  `docker-compose.yml` is public and only applies when the volume is created;
  the live role was rotated with `npm run db:rotate-password`, and the real
  one lives only in `.env.local` (mode 600).
- **The nightly sync runs whatever branch is checked out.** Leave the working
  tree on `main` between sessions.
- **A couple of rows sit at the bare `Subscriptions` parent** in July 2026 while every
  other row of the same merchants is in a subcategory — likely oversights, left
  alone because they are human decisions. The guesser counts a parent vote
  toward its own child, so they do not mislead it.

## Open questions

Flagged rather than guessed at, per `docs/DESIGN.md` §12:

- **Annual fee amortisation.** A card's annual fee spikes one month's fixed
  costs. Shown as-is today; spreading it over twelve months is a view change now
  and a data migration later.
- **Reconciliation surfacing.** A passive banner today, and now quiet: it
  tests both bases (balances that include pending rows and balances that do
  not) and reports an account only when neither matches, so the cards no longer
  show phantom drift. One genuine checking difference remains — confirmed not
  timing; Right now has the next step.
- **Feed fields thrown away.** SimpleFIN's `payee` and the Chase CSV's `Type`
  are dropped on ingest (the `categorization-design` branch's finding). Both
  would feed the guesser directly. Not built.
- **An identical CLI re-import errors.** `scripts/import-csv.ts` records its
  batch as `running`, deduplicates (inserting nothing), then fails marking it
  `ok` against the unique file hash, leaving a stale `running` batch row. The
  ledger is right either way; the Accounts page instead reports "already
  imported". Checking for a prior import first would make the two agree.
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
data/statements/<acct>/  statement exports already imported, one file each — gitignored
db/dumps/                ledger backups from npm run backup — gitignored, local only
src/money.ts             the only cents↔display path
src/lib/queries.ts       every read, through v_transactions
src/lib/edit.ts          every manual write, plus the audit log
```
