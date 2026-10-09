# The overhaul: Flow first, in colour, with a Review inbox

Proposed 2026-10-07; the owner chose the direction the same day. Revised
2026-10-08 with the owner's second round of asks, which moved the Flow to the
front, replaced the colour scheme and added a second level of Flow.

The work happens on a local branch, `overhaul`. Nothing is pushed and no PR
is opened until the owner asks: there will be many design changes, and a
review round-trip per change would slow them down.

**Where it stands (2026-10-08):** all nine steps below are built on
`overhaul`, one commit each, and checked on the demo ledger in both themes
and at phone width. V1–V10 each have a test: V1, V2 and V3 in
`tests/flow.test.ts` and `tests/review.test.ts` against the app's own
queries, V2 again end to end in `tests/visual/links.spec.ts`, V9 in
`tests/design-tokens.test.ts`, V10's shades in `tests/palette.test.ts`.
The a11y suite's known list is empty. The later asks (7–9: the folding
picker, shades within a group, the Monarch-like cards) are built too. Not
pushed; waiting on the owner's look.

## The asks

**2026-10-07**, answered as choices:

- The ledger is used four ways every week: reviewing new transactions,
  checking where the month stands, seeing where money went, and bookkeeping.
- Layout: a month view plus a Review inbox.
- Credits (refunds, Daily Cash) are their own source on the left of the Flow.
- Category detail in the Flow: the top few per bucket, expanding on click.

**2026-10-08**, in the owner's words, then what each means here:

1. *"I don't like how ledger and cashflow are the same thing."* The wordmark
   and the first tab both opened `/`, and the app called itself one thing and
   its first page another. The wordmark names the app; it is not a second
   link to a page.
2. *"I want flow to be the first page that I see."* `/` is the Flow.
3. *"I want the entire color schema to change."* New grounds, inks and chart
   colours, in a light and a dark theme.
4. *"A much higher variety of color for the sankey."* Spending is coloured by
   what kind of thing it was (its category group), not by a single bucket
   tone.
5. *"A multi-sankey view."* The main Flow shows categories and one level of
   subcategories. Below it, any category or subcategory can be picked to see
   its own Flow of everything underneath. Few categories have subcategories
   today; most will.
6. *"Use the tools you have to make as good a design as you can,"* then build
   all of it.

**2026-10-08, later**, after seeing the first build:

7. *"In the 'inside a category' I would like the category dropdown to have
   internally collapsable sections"* — a group (Housing, Transportation) and
   a parent (Shopping, Subscriptions) each fold.
8. *"As we go one layer deep, it would be great for each category to be
   slightly different but in the same color category… every category inside
   shopping / subscriptions should be their own offshoots… maybe a formula
   for a few shades darker than the parent."* Each category is its own shade
   of its group's colour; each subcategory a deeper shade of its parent's.
9. *"I would like the main dashboard to look a bit more like"* Monarch Money's
   cash-flow report, *"giving an 'apple like' polished look."* Cards on a soft
   ground, summary figures across the top, and a chart whose ribbons fade
   from one node's colour to the next, labelled inside the chart with
   amount and share.

**2026-10-08, evening**, after seeing that:

10. *"I like the way monarch money does it where its one large cut from the
    left, and we can still ensure that income and from savings are
    seperate, but maybe just a gradient blend and then it splits into the
    rest. Its also easier to follow the money 'split'."* The sources stack
    into one bar as tall as the junction, their ribbons run straight into it
    as one block and blend there, and the junction is a labelled total that
    the money visibly splits from.

## Why

The first round's findings still stand, and the work below fixes each one:

- **Reviewing** happens inside the register, behind a chip whose count
  disagrees with the table (216 to review, 204 shown — the twelve missing
  rows are in Credit Card Payment, which the register hides by default but
  `getReviewCounts` still counts). Every row is a mouse click.
- **Where the month stands** and **where money went** were two pages —
  Cashflow and Flow — about the same month, each with its own period picker,
  the second repeating the first's category list.
- **Bookkeeping** (CSV import, balances, income sources) shares the Accounts
  page with net worth and investment returns.
- The Sankey rounded to "$2.9k" in a ledger that prints cents everywhere
  else, hid most categories in "+4 more" nodes that could not be opened, and
  its four bucket colours failed a colour-blindness check (Required and
  Invested: ΔE 8.3 with normal vision, 3.3 for deuteranopia; the floor is
  15). Its balance problem — category flows exceeding their bucket whenever a
  category netted to a credit — is fixed (PR #22).
- The design tooling found the rest: amber spent on things that are not
  human edits (the Cards and Reconciliation labels, the selection checkbox,
  the keyboard focus ring); outflow blue and invest violet below 4.5:1 as
  text; the month-filtered register still labelled "All time"; voided rows
  still offering Accept; a hydration mismatch on the register; the balance
  form defaulting to tomorrow after 7pm Central.

## The shape

```
ledger     Flow   Review · 12   Register   Accounts   Setup              ◐
```

- **ledger** — the wordmark. Plain text, not a link.
- **Flow** (`/`) — the month: five figures, the main Flow, a category's own
  Flow, fixed against variable. Replaces Cashflow and the old Flow page;
  `/flow` renders the same page, so old links keep working (V7).
- **Review** (`/review`) — every unconfirmed guess and every uncategorised
  row, as an inbox driven from the keyboard. Its count is in the nav.
- **Register** — the whole ledger: search, filter, edit.
- **Accounts** — balances, net worth, investment returns, the sync status,
  and the two passive checks (cards settled, ledger matches the bank).
  Viewing only.
- **Setup** (`/setup`) — income sources, statement import, recording a
  balance.
- **◐** — the theme: System, Light or Dark. System is the default.

The period travels between Flow and Register (V5).

## The Flow page, top to bottom

Everything below the heading sits on **cards**: white sheets on the soft
ground, rounded, lifted by a shadow soft enough to read as depth rather than
as a border (on the dark ground, a lighter sheet with a hairline). The
reference is Monarch's cash-flow report; the aim is the calm of Apple's own
apps — few lines, generous space, type doing the work.

1. **The period** is the heading, as now. Under it, one card — only when
   something needs attention: a reconciliation difference, a card that does
   not settle, a failed sync. The all-clear versions of those lines live on
   Accounts.
2. **The month in figures.** Five cards: Income, Required, Discretionary,
   Invested, and Left over (or From savings, when the month spent more than
   came in) — the same numbers the Flow's nodes carry, so the page agrees
   with itself. The number is the card's largest thing, dollars large and
   cents a step down; the change from the previous period of the same
   length sits under it. The whole card opens its rows (V2).
3. **The Flow**, on its own card: the dates as its title, the group legend,
   *Show every category* and a Chart / Table segmented control.
4. **Inside a category**, on its own card: the picker and that category's own
   Flow.
5. **Fixed against variable**, twelve months, on its own card.

Headline figures and chart labels use the sans face at tabular widths: the
digits still align, without the typewriter voice the register keeps.

The old Cashflow category list and the old Flow drilldown both become the
Flow's table view: one list of the same numbers, not two.

### The main Flow

Five columns, left to right:

| Column | Nodes | Colour |
|---|---|---|
| Sources | Income · From investments · Credits · From savings | slate |
| Junction | **Available**: the total, labelled, as tall as the sources together | slate |
| Buckets | Required · Discretionary · Invested · Left over | slate |
| Categories | the top-level categories under each bucket | the category's own shade of its group |
| Subcategories | one level, for categories that have them | a deeper shade of the parent's |

- Every flow is gross, so every node balances to the cent (V1). The junction
  is kept on purpose: without it the chart would have to decide which source
  paid for which bucket.
- **The trunk.** The sources stack flush, one bar with a hairline seam
  between them, exactly as tall as the junction and level with it, so their
  ribbons run straight across and read as one solid block — one cut from the
  left. Each ribbon fades from its source into the junction's ink, so the
  sources are separate where they start and one stream where they arrive:
  From savings' hatch dissolves into the solid. The junction is labelled
  **Available** with the total, and the money splits from there. The same
  holds in a category's own Flow, where the buckets that paid for it are the
  trunk.
- **Left over** mirrors it: the solid stream fades into the hatch as it
  reaches the bucket.
- **Labels never collide.** Within a column, labels that would overlap are
  spread apart as a group, centred on where they want to be, and kept inside
  the chart — which matters in the trunk, where a sliver of credits sits
  flush against a whole paycheck.
- **The prism.** Money arrives as one calm slate stream and splits into
  colour only where it was spent. Sources and buckets are two slate inks,
  distinguished by lightness and label; From savings and Left over are
  hatched — the same hatch for money moving out of or into savings, which
  can never both happen in one month. The categories carry all the colour.
- **Ribbons fade** from the colour of the node they leave to the colour of
  the node they reach, as soft tints, so money visibly becomes what it was
  spent on.
- **Labels sit inside the chart**, beside each node on the side its money
  arrives from: two lines, the name, then the amount and its share —
  `$1,234.56 (12.3%)`. Sources and buckets take their share of everything
  that came in; categories and subcategories their share of spending.
- Within a bucket, categories are ordered by group, then by amount, so each
  group reads as one band of colour and neighbouring colours are neighbours
  in the palette's validated order.
- Each bucket shows its largest categories and a **+N more** node that
  expands that bucket in place. A category's subcategories fold the same
  way.
- Spending filed on a parent itself, rather than on one of its
  subcategories, is a node called **General** — the word the category picker
  already uses for "the parent itself".
- **Hover** highlights the node's path and shows its amount, its share of
  the month's spending, and its number of transactions.
- **Click** a category or subcategory to look inside it (below). Click a
  source or bucket to open its rows in the register.
- **Keyboard.** Every node is focusable and does on Enter what a click does.
  The scroll region is focusable too.
- **Table view.** The same tree as rows — bucket, category, subcategory,
  amount, share, transactions — every name a link to its rows.

### Inside a category

The second level of Flow, below the main one.

- **Picking.** A picker lists every category and subcategory that had money
  in the period, as a tree: each group with its colour and total, each
  category with its own shade and amount, subcategories under their parent.
  A group folds away, and a parent folds its subcategories — by click, or
  from the keyboard (→ unfolds, ← folds or steps out to the parent). Groups
  start open and parents start folded, except the one holding the current
  choice; what was folded is remembered in the browser between visits.
  Typing searches through every fold. Clicking a category in the main Flow
  picks it and scrolls here. The choice is in the URL (`?focus=<category id>`), so it
  survives a reload and the back button undoes it. With nothing picked, the
  largest category that has subcategories is shown; failing that, the
  largest category.
- **Columns:** the bucket or buckets it was paid from → the category → its
  subcategories → the merchants. Subcategories are never folded here;
  merchants show the top five per subcategory and **+N more**.
- **Any depth.** The model is a tree and the chart draws whatever depth it
  is given. The schema caps categories at two levels today (category >
  subcategory), so picking a subcategory shows subcategory → merchants;
  lifting the cap would be a schema change, not a chart change.
- The header names the category, its total and its transaction count, and
  opens those rows in the register (V2).

### Colour

The whole scheme changes. Two themes, each chosen rather than flipped:

| Role | Light | Dark |
|---|---|---|
| Ground | `#f3f3ef` | `#151716` |
| Card | `#ffffff` | `#1c1e1d` |
| Raised (menus, editor) | `#fbfbf8` | `#1d201e` |
| Well (inputs, tracks) | `#e8e8e2` | `#252826` |
| Rule | `#dadad3` | `#2d312e` |
| Ink | `#1b1d1a` · 15.3:1 | `#ecede8` · 15.3:1 |
| Ink, dim | `#474a45` · 8.1:1 | `#b6b9b2` · 9.1:1 |
| Ink, faint | `#62655f` · 5.3:1 | `#8f938c` · 5.8:1 |
| Edited (reserved) | `#915b02` · 5.1:1 | `#efb146` · 9.5:1 |
| Earned | `#137738` · 5.1:1 | `#62d286` · 9.5:1 |
| Alert | `#ba2b28` · 5.5:1 | `#f47c70` · 6.8:1 |

Ratios are against the ground; every text ink is also ≥ 4.5:1 on a card,
on Raised and on Well.

**Reserved meanings.** Amber means a human changed this, and nothing else
(V4) — it survives the new scheme unchanged in meaning. Green text means
money earned. Alert red is for errors and differences that need a person,
always beside words that say what is wrong. These three are text and marks
and never chart colours; the group palette is fills and swatches and never
text. The two meet only as a swatch beside a category's name.

**The group palette.** Eight slots in a fixed order. A category takes its
group's slot; the slot is the group's position among the groups that hold
spending categories, in the taxonomy's sort order — so it changes only when
the taxonomy does. A ninth spending group would be drawn in neutral ink with
its label, never in a generated colour.

| Slot | Hue | Light | Dark | The demo's group |
|---|---|---|---|---|
| 1 | blue | `#145ec1` | `#4385e4` | Housing |
| 2 | teal | `#079390` | `#16a7a3` | Transportation |
| 3 | coral | `#d6612f` | `#e27033` | Food |
| 4 | violet | `#6b3baa` | `#8557c8` | Health |
| 5 | magenta | `#b82d67` | `#da4786` | Lifestyle |
| 6 | olive | `#61911c` | `#71a428` | Financial |
| 7 | sky | `#027eb1` | `#3096cb` | — |
| 8 | rose | `#d15a63` | `#c74a51` | — |

Checked with the dataviz validator against each theme's ground:

- **Light:** worst adjacent normal-vision ΔE 18.7, CVD ΔE 11.2; every slot ≥ 3:1.
- **Dark:** worst adjacent normal-vision ΔE 15.7, CVD ΔE 11.6; every slot ≥ 3:1.
- **Slots 1–6 skipping one** — what a month with a group missing puts side by
  side: light 15.7 / 14.3, dark 15.3 / 12.6.

No palette of six hues can pass with *every* pair touching (the validator's
all-pairs mode), and a month can skip any group. So colour is never the only
thing identifying a category: every node is labelled, touching ribbons are
parted by a seam, and the table view carries the same numbers.

The neutral chart inks — the Flow's sources and buckets, fixed against
variable — are a cool slate (light `#21344c` / `#6f869e`, dark `#ccddee` /
`#647a92`): two steps at least 3:1 apart and each at least 3:1 against the
ground and a card. Slate rather than grey, so money not yet spent reads as
calm rather than switched off.

**Shades within a group** (`src/lib/palette.ts`). The slot gives a group its
hue; each category takes its own shade of it, and each subcategory a shade of
its parent's. All of it is arithmetic in OKLCH from the slot colour in
`tokens.json`, so `globals.css` stays the one place the palette is written,
and it depends only on the taxonomy — never on a month's numbers.

- **Siblings** take evenly spaced lightnesses across a band around the
  group's colour (±0.12 in OKLCH lightness, widened until neighbours are at
  least 0.045 apart), the first nearest the group's own colour, the rest
  alternating lighter and darker — the same order in both themes, so the
  lighter of two oranges is the lighter in both. Each step also turns the
  hue a few degrees, keeping a family recognisable: Groceries, Restaurants
  and Coffee are three oranges.
- **Subcategories** take the same spread on the *deeper* side of their parent
  only — darker on the light theme, lighter on the dark one, further from
  the page either way — starting a step past it. The deep end of each
  group's range is kept free for them, so a parent never runs out of room.
- **Never a reserved hue.** A turn goes whichever way — or not at all — keeps
  clearest of amber, earned green and alert red, with amber given the widest
  berth; no shade comes within 25° of amber's hue.
- **Legible as marks.** Each shade clears 2.3:1 against the ground and a card.
  That is below the 3:1 the group colours themselves clear, which the
  dataviz relief rule allows because no shade identifies anything alone:
  every node is labelled and the table carries the same numbers.

`tests/palette.test.ts` holds each of these, in both themes.

## Invariants

These hold for every change below. Each gets a test.

| | |
|---|---|
| **V1** | **The Flow balances to the cent, at every level.** Sources = junction = buckets; each bucket = Σ its categories; each category = Σ its subcategories and General; in a category's own Flow, each subcategory = Σ its merchants. For every period, including months with credits, a zero bucket, spending above income, and no income at all. Tested against the app's own queries on synthetic data, not a re-implementation of them. |
| **V2** | **Every number opens to its rows.** Every figure, source, bucket, category and subcategory has a way to the register filtered to exactly the transactions that make it, and the register's total for that filter equals the number. In the chart, a category's click looks inside first; its rows are one more click, from the detail's header or the table. |
| **V3** | **A count is what its destination shows.** The Review badge counts exactly the rows Review lists; a register chip counts exactly the rows it filters to. (Today's 216/204 fails this.) |
| **V4** | **Amber means a human changed this, and nothing else.** No new use of `--color-edited`; the four misuses above are removed. |
| **V5** | **One period.** The period chosen on Flow or Register is the one the other opens on. Review opens on everything outstanding, whatever the period, because its badge counts everything outstanding (V3); its own picker narrows it. |
| **V6** | **Review is keyboard-complete.** Every review action has a key; nothing in Review needs the mouse. |
| **V7** | **No redirect to a URL taken from a request.** The Playwright MCP's origin allowlist depends on it (see `CLAUDE.md`). Old routes keep working by rendering. |
| **V8** | **I1–I8 are untouched.** Review's accept is the existing confirm (it locks the category and writes `transaction_edits`); nothing about money handling changes. |
| **V9** | **Legible and distinguishable, in both themes.** Text ≥ 4.5:1 on every ground it sits on. The group palette passes the dataviz validator on its adjacent pairs in slot order (normal-vision ΔE ≥ 15, CVD ΔE ≥ 8) and is never the only cue: labels, seams and the table carry identity too. |
| **V10** | **Colour follows the category, everywhere.** A category's colour is its own shade of its group's slot, a subcategory's a deeper shade of its parent's — in the main Flow, a category's own Flow, the picker, the register, Review and the category page alike — and it comes from the taxonomy alone, so a period missing some categories does not repaint the rest. |

## How the asks interact

- **Flow first absorbs the Month page.** The first round's Month page *is*
  the Flow page; the figures and fixed-against-variable come with it. The
  Cashflow category list and the Flow drilldown are replaced by the table
  view.
- **More colour against V9.** One hue per category cannot work — the seeded
  taxonomy alone has twenty-eight spending categories, and past eight hues no
  colour can be told apart. Colouring by group gives six to eight
  hues, each meaning something. Making the buckets neutral is what lets the
  group colours carry without the two systems competing.
- **More colour against amber.** Amber stays reserved (V4). The palette has
  no amber slot, and a group's colour is never used for text, so the two
  cannot be mistaken for each other where they meet in the register.
- **The multi-Sankey against "top few, expand on click".** The main Flow
  folds — the top categories per bucket, the top subcategories per
  category — and expands in place. A category's own Flow never folds
  subcategories, only merchants.
- **The multi-Sankey against V2.** A category's first click now looks inside
  rather than opening the register; the rows stay one click away and the
  table's names still link straight to them.
- **Five columns against a phone.** The Flow keeps its width and scrolls
  sideways inside a focusable region; the table is one tap away.
- **New colour beyond the chart.** The group's colour travels to the
  register's category column, the category picker and the category page
  (V10), as a small square — never a diamond, which is the edit marker's
  shape.
- **Shades against the palette's validation.** The validator passes the
  group slots, which stay as they were. Shades within a group are not meant
  to be told apart by colour alone — the label does that — so they are held
  to a lower bar (2.3:1, distinct from their siblings) and never to a hue
  outside their group's family.
- **Monarch's look against the ledger's voice.** The cards, tints and inside
  labels come from Monarch; the exact cents, the reserved amber, the prism
  and the register's mono columns stay the ledger's own.
- **Two themes against the Figma tokens.** `tokens.json` carries both themes
  as two token sets, and `npm run tokens` derives both from `globals.css`.
- **The demo has no subcategories.** Its seed gains three parents with
  subcategories (the real ledger's shape), a refund in a category that also
  spends, and spending in every group, so the Flow can be judged on
  synthetic data.
- **The Review badge against the travelling period.** Resolved in V5.

## The work, in order

On the local branch `overhaul`, a commit per step, nothing pushed. Each step
is looked at on the demo ledger (`npm run dev:demo`) before the next starts,
and visual baselines are only updated after they have been looked at.

1. **Foundation.** Semantic colour tokens; the light and dark themes; the
   theme switch; `tokens.json` with both themes; the token tests extended to
   both themes and to the group palette's validation.
2. **Demo data.** Subcategories, a refund, spending in every group.
3. **The Flow's model.** The tree — sources, buckets, categories,
   subcategories, General — and a category's own tree down to merchants,
   both from the app's queries. *Accepts when:* V1 holds at every level for
   the demo's six months and the synthetic edge cases.
4. **The Flow page at `/`.** Figures, the main Flow, the table view, inside a
   category, fixed against variable, the status line; `/flow` renders it;
   the nav and wordmark. *Accepts when:* V2 holds for every number on the
   page (an end-to-end test clicks through), V9 and V10 hold, and nothing
   that was reachable from Cashflow or the old Flow is lost.
5. **Review.** `/review`, the keyboard model, the nav badge; the count bug
   fixed at its source (`getReviewCounts` takes the same filters as the
   table). *Accepts when:* V3 holds in the register and in Review; V6 holds;
   accepting a row writes the same `transaction_edits` row it does today.
6. **Setup.** Income sources, statement import and recording a balance move
   out of Accounts. *Accepts when:* every action works from its new place and
   Accounts points at it.
7. **Colour through the rest of the app.** The register, the category page,
   the pickers and the chips in the new scheme; the amber misuses removed;
   the a11y suite's known list emptied. *Accepts when:* V4 and V9 hold and
   `tests/visual/a11y.spec.ts` has no known violations left.
8. **Small fixes.** Balance form date default, the register's hydration
   mismatch, "All time" on a filtered register, Accept on voided rows.
9. **Proof.** Unit tests, visual baselines for both themes, the a11y and
   links suites, Storybook stories for every new component.

## Open questions

1. **Deeper categories.** The schema allows one level of subcategory. The
   Flow is written for any depth; lifting the cap would touch the schema, the
   rollup in `v_transactions` and the category picker.
2. **A ninth spending group.** Drawn in neutral ink with its label (above).
   If groups multiply, the palette needs a second dimension, not more hues.
3. **The Flow on a phone.** Built: on a narrow screen both Flows open as
   tables, with the chart a tap away, scrolling sideways in a focusable
   region. A vertical Flow is the better answer if the phone becomes a place
   this is used.
4. **Review's rhythm.** Built as proposed, open to change: accepting moves to
   the next row; accepting every row from a merchant is `m` with an inline
   confirm (Enter or Esc). The merchant-wide accept reaches that merchant's
   unlocked rows in every period, as the register's "apply to the others"
   always has.
