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

## Right now · last updated 2026-10-06

**Both listeners are loopback-only now.** Postgres was published on every
interface, behind the password printed in `docker-compose.yml`, and `next dev`
binds every interface by default — an unauthenticated ledger, one hop from the
local network. Both now bind loopback, and `src/proxy.ts` refuses DNS
rebinding and cross-site writes. Verified against a running server: the LAN
address refuses both ports, a forged Host gets 421, a cross-site POST 403.

**The last traces of the model are gone.** The `llm` category source is
dropped from `schema.sql` and from the live database. The one row carrying it
was a superseded pending row no view shows; it now reads `history`. Migrated
by hand after `npm run backup` and a rehearsal on a restored copy: cashflow,
net worth, every resolved transaction, raw amounts, the edit log and the view
definitions hashed identically before and after. `tests/no-network.test.ts`
fails on any LLM SDK (transitive included), LLM API host, or outbound request
other than SimpleFIN's.

Both are merged (PR #12). PR #13 followed: self-hosted fonts — the browser no
longer contacts Google on every page view — a test that no page names a
third-party URL, real figures scrubbed from the public docs, the API key out
of `.env.example`, and `npm run db:rotate-password`, which the owner has run:
the compose default password is now refused.

**The sync runs once a day**, from launchd on this machine
(`npm run sync:schedule -- status`): at midnight, on waking if the Mac was
asleep then, or at the first login after a day it was off — and only if no
sync has succeeded since midnight, so a login on a day already done costs
nothing. One SimpleFIN request on a normal day — one per 45-day window when
catching up further. Nothing is retried within a run; a sync cut short by a
rate-limit warning leaves its backfill unmarked, and the next run repeats it.
The ledger was caught up by hand on 2026-10-06 after two weeks without a sync.

**Waiting on the owner:**

- `chmod 600 .env.local` — it is readable by other local users, and env files
  are off-limits to the agent.
- The bridge reports the Apple Card connection needs re-authenticating, so
  every sync is `partial` and that card's balance is stale. Reconnect it in
  the SimpleFIN bridge, or remove it there if the card is imported by CSV.
- The first paycheck was filed as Paycheck by the payroll pattern, as a guess —
  the registered income source did not match it. The bank prints the employer
  differently from the registered payer text, and the feed masks most of the
  originator ID. Re-register the source with the text the deposit actually
  carries.
- Checking's one unexplained reconciliation difference moved slightly with
  this sync. If the next sync does not move it back, it is not a timing gap.

**Deferred, by the owner's choice:** Tailscale access comes last. A separate
least-privilege database role was declined — one person, one machine, and
small PRs matter more here than the extra isolation.

**Categorisation no longer uses a model.** Merged in PR #12. The LLM step,
the Anthropic SDK and the API key are gone;
a deterministic guesser (`src/categorize/guess.ts`) learns from the ledger's
own human decisions instead. Every guess is still a guess — the owner
confirms each one — which is exactly why paying a model for them bought
nothing. Measured with `npm run backtest`, replaying the ledger's decisions:

| | exact category | precise when it guesses | guesses at all |
|---|---:|---:|---:|
| in date order (only earlier decisions known) | 79% | 94% | 84% |
| hold-out (every other decision known) | 87% | 96% | 91% |

Confidence tracks accuracy: the 0.8+ band is right ~97% of the time.

**Income sources** are new: a payer (description text or ACH originator ID)
maps to a category, managed on the Accounts page. A match is *known*, not
guessed, and skips review. The owner's employer is registered by name, ahead
of its first deposit. **When that first paycheck lands, check it was filed
as a known Paycheck** — if the bank prints it through a payroll processor
under another name, add the originator ID from that deposit.

The `categorization-design` branch's finding (SimpleFIN `payee`, Chase `Type`
are dropped on ingest) is still unacted on; both would feed the guesser
directly.

Two rows are filed at the bare `Subscriptions` parent in July 2026 while
every other row of the same merchants sits in a subcategory — likely
oversights. Left alone (they are human decisions); the guesser no longer
trips on them, since a parent vote counts toward its own child.

Two standing tasks the owner tracks — details in `private/STATE.local.md`:

- Record a brokerage balance monthly, so investment performance has a period to
  measure over. One snapshot is a starting line, not a return.
- Register a new income source on the Accounts page when one starts.

---

## Where the project got to

All seven milestones from `docs/DESIGN.md` are done and accepted against their
own checks. The app runs against live bank accounts, not fixtures: several
hundred transactions spanning about two years, fully categorised, reconciling
against the banks' own balances.

Connected: two card/bank feeds through SimpleFIN on a daily pull and one
snapshot-tracked brokerage. Categorisation is local and deterministic.

The cards carry their own proof: `getCardSettlement()` checks, per card, that
`purchases − payments_applied = still_owed = what the issuer reports`. While
that holds, counting card purchases as spending — and the payments that settle
them as transfers — is sound rather than assumed. It holds to the cent today.

## Decisions worth not relitigating

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

## Open questions

Flagged rather than guessed at, per `docs/DESIGN.md` §12:

- **Annual fee amortisation.** A card's annual fee spikes one month's fixed
  costs. Shown as-is today; spreading it over twelve months is a view change now
  and a data migration later.
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
