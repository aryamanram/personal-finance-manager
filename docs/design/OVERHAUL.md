# The overhaul: a Month page, a Review inbox, and a Flow that balances

Proposed 2026-10-07. The owner chose the direction the same day; the open
questions at the end are still theirs.

## Why

The ledger is used four ways every week, and each one is harder than it
needs to be:

- **Reviewing new transactions** happens inside the register, behind a chip
  whose count disagrees with the table (216 to review, 204 shown — the twelve
  missing rows are in Credit Card Payment, which the register hides by
  default but `getReviewCounts` still counts). Every row is a mouse click.
- **Checking where the month stands** and **seeing where money went** are two
  pages — Cashflow and Flow — about the same month, each with its own period
  picker, the second repeating the first's category list.
- **Bookkeeping** (CSV import, balances, income sources) shares the Accounts
  page with net worth and investment returns.

The Flow's Sankey has its own problems: its category flows exceed their
bucket whenever a category nets to a credit (the demo's Discretionary reads
$530 above flows totalling $533), it rounds to "$2.9k" in a ledger that
prints cents everywhere else, it hides most categories in "+4 more" nodes
that cannot be opened, and its four bucket colours fail a colour-blindness
check (Required and Invested: ΔE 8.3 with normal vision, 3.3 for
deuteranopia; the floor is 15).

The design tooling found the rest: amber spent on things that are not human
edits (the Cards and Reconciliation labels, the selection checkbox, the
keyboard focus ring); outflow blue and invest violet below 4.5:1 as text;
the month-filtered register still labelled "All time"; voided rows still
offering Accept; a hydration mismatch on the register; the balance form
defaulting to tomorrow after 7pm Central.

## The shape

```
ledger   Month   Review · 12   Register   Accounts   Setup
```

- **Month** (`/`) — the month at a glance: the four figures, the Flow as the
  centrepiece, the categories, fixed against variable. Replaces Cashflow and
  Flow. `/flow` keeps working.
- **Review** (`/review`) — the unconfirmed guesses as an inbox, driven from
  the keyboard. Its count is in the nav.
- **Register** — the whole ledger: search, filter, edit. Unchanged in role.
- **Accounts** — balances, net worth, investment returns. Viewing only.
- **Setup** — income sources, statement import, recording a balance.

The chosen period is one piece of state: it travels with you between Month,
Review and Register.

### The Flow

- Three sources on the left: **Income**, **From savings** (when the month
  spent more than came in) and **Credits** (refunds, Daily Cash — anything
  that came back into a spending category). Every flow is gross, so every
  node balances to the cent and nothing is netted out of sight.
- The sources meet at a thin, unlabelled junction, then split into the
  buckets — Required, Discretionary, Invested, Left over. The junction is
  kept on purpose: without it the chart would have to decide which source
  paid for which bucket.
- Each bucket shows its largest categories and a **+N more** node that
  expands that bucket in place when clicked.
- Every label is an exact amount in tabular figures: `$1,234.56`, not
  `$1.2k`.
- Hovering a node or ribbon highlights its path and shows the amount, its
  share of the month and the number of transactions. Clicking a category
  opens the register filtered to exactly those transactions.
- A table view carries the same numbers, for screen readers and for anyone
  who would rather read than trace.

## Invariants

These hold for every PR below. Each gets a test.

| | |
|---|---|
| **V1** | **The Flow balances to the cent.** Sources = buckets = Σ categories per bucket, for every period, including months with credits, a zero bucket, or spending above income. Tested against the app's own queries on synthetic data, not a re-implementation of them. |
| **V2** | **Every number opens to its rows.** Clicking a figure, bucket or category opens the register filtered to exactly the transactions that make it, and the register's total for that filter equals the number clicked. |
| **V3** | **A count is what its destination shows.** The Review badge, and any chip, counts exactly the rows the view it opens will list. (Today's 216/204 fails this.) |
| **V4** | **Amber means a human changed this, and nothing else.** No new use of `--color-edited`; the four misuses above are removed. |
| **V5** | **One period.** The period chosen on any of Month, Review or Register is the period the others open on. |
| **V6** | **Review is keyboard-complete.** Every review action has a key; nothing in Review needs the mouse. |
| **V7** | **No redirect to a URL taken from a request.** The Playwright MCP's origin allowlist depends on it (see `CLAUDE.md`). Old routes keep working by rendering, or by redirecting to a fixed path. |
| **V8** | **I1–I8 are untouched.** Review's accept is the existing confirm (it locks the category and writes `transaction_edits`); nothing about money handling changes. |
| **V9** | **Legible and distinguishable.** Text ≥ 4.5:1 on its ground. The Flow's bucket colours pass the dataviz validator for *all* pairs (any two buckets can touch once one is zero): normal-vision ΔE ≥ 15, CVD ΔE ≥ 8. |

A cool-only palette clears V9, so the amber rule survives — and one exists
that keeps the app's identity. Sweeping OKLCH hues 150–330° in the dark
band with today's outflow blue pinned, the dataviz validator passes every
check, all pairs, on:

| Bucket | Today | Proposed |
|---|---|---|
| Required | `#3a6ea5` outflow blue | `#3a6ea5` — unchanged |
| Invested | `#6a5cb8` violet | `#a17adf` lavender — same family, lifted |
| Discretionary | `#5bbfe0` cyan | `#29a895` teal |
| Left over | `#6ee7c0` aqua | `#2b7440` green — money still yours |

Worst pair 16.7 normal-vision, 10.9 CVD; every slot ≥ 3:1 on the ground.
Today's four score 8.3 and 3.3.

## The work, in order

Small PRs, each with the CodeRabbit loop. Visual baselines are updated in
each one and looked at before they are committed.

1. **The Flow.** Gross bucket and credit totals from one query; sources,
   junction, buckets, categories; +N more; exact labels; hover and click;
   table view; the validated palette through `globals.css` and
   `npm run tokens`. Built on `/flow` first, so it can be judged alone.
   *Accepts when:* V1 holds for the demo's six months and for synthetic
   cases (credit-only category, zero bucket, spending > income, a month with
   no income); V9 passes the validator; each category's click lands on a
   register whose total equals the label; Storybook covers every case.
2. **Review.** `/review`, the keyboard model, the nav count; the count bug
   fixed at its source (`getReviewCounts` takes the same filters as the
   table). *Accepts when:* V3 holds in the register and in Review (a test
   asserts count = rows for every filter combination); V6 holds; accepting a
   row writes the same `transaction_edits` row it does today.
3. **Month.** Cashflow and Flow become `/`; the period travels (V5); `/flow`
   still answers. *Accepts when:* V2 holds for every figure on the page;
   nothing that was reachable is lost.
4. **Setup.** Income sources, statement import and recording a balance move
   out of Accounts. *Accepts when:* every action works from its new place
   and the old page still points at it.
5. **Colour and accessibility.** The amber misuses, the two text contrasts,
   the a11y suite's known list emptied. *Accepts when:* V4 and V9 hold and
   `tests/visual/a11y.spec.ts` has no known violations left.
6. **Small fixes.** Balance form date default, the register's hydration
   mismatch, "All time" on a filtered register, Accept on voided rows. Can
   land any time; none waits on the rest.

## Open questions

1. **The bucket colours above** — proposed, not yet seen on screen. PR 1
   renders them in Storybook and on the demo before anything merges.
2. **Review's rhythm.** Does accepting move straight to the next row, and
   should "accept every row from this merchant" be one key or a confirm?
3. **The Flow on a phone.** It scrolls sideways today. A vertical layout, or
   buckets only with categories in the list below?
