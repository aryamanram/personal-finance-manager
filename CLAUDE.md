# Working on this repo

Read this first. It is loaded automatically at the start of every session and is
the contract between one chat and the next.

@AGENTS.md

## What this is

A self-hosted finance tracker for one person, running on **real bank data**. It
is not a demo. A wrong number here is a wrong number about someone's money, so
"it renders" is never the bar — reconcile against the bank, or say you did not.

Three documents carry the design, in this order of authority:

1. **`docs/DESIGN.md`** — the spec. Written before any code, including eight
   numbered invariants (I1–I8) and per-milestone acceptance checks. Its choices
   are decisions, not defaults.
2. **`docs/INGEST_NOTES.md`** — the algorithms the schema assumes but cannot
   enforce: counting dedup, adoption, pending supersession, transfer matching.
3. **`docs/architecture/`** — four diagrams, from system context down to module
   detail. Start at `README.md`.

`db/schema.sql` is the authoritative DDL. Edit it, not a migration, and never
let a tool generate DDL that fights it.

## Before you change anything

```bash
npm run db:up        # Postgres 16 on :5433
npm test             # must be green before you start, not just after
```

`docs/STATE.md` carries what has been settled — decisions and their reasons,
plus a short dated "Right now". Read it before starting, and run `/handoff` at
the end of a session to update it. Most of it is decisions and does not rot; the
volatile part is deliberately small so staleness is visible.

## The rules that are not negotiable

These come from `docs/DESIGN.md` §2. Each has a test; `npm test` is the check.

| | |
|---|---|
| **I1** | Money is integer cents. Never a float, never `parseFloat` on a currency string. `src/money.ts` is the only cents↔display path. |
| **I2** | Raw source values are immutable. Corrections go in `*_override` columns — that is what makes reconciliation possible. |
| **I3** | Read through `v_transactions` and use `eff_*`. Never resolve `COALESCE` in TypeScript. |
| **I4** | Machine passes never overwrite human decisions. Every batch query carries `NOT category_locked`. |
| **I5** | Nothing is hard-deleted. Void it, or the next import resurrects it. |
| **I6** | Every manual edit writes a `transaction_edits` row. |
| **I7** | Re-importing the same file is a no-op. |
| **I8** | A CSV row and a synced row for the same transaction resolve to ONE row. |

## How work gets done here

**Verify against reality, not against the code.** Nearly every bug found in this
project was invisible from reading: a transfer join that silently dropped half
its pairs, dates off by one west of Greenwich, `fetch` refusing a credentialed
URL, an LLM hiding thousands of dollars by calling spending a transfer. Run it,
hit the real service, look at the rendered page.

**Tests assert arithmetic, not execution.** "12 pairs link, and exactly 12" beats
"the function returned". A test that re-implements the logic it is testing passes
when the real code is wrong.

**Say what you actually did.** If a check was skipped, say so. If a number came
from a fixture rather than the bank, say that.

## Privacy is a hard constraint

The repo is public. It holds the code for a finance tracker, never the finances.

- `npm run check:privacy` runs as a pre-push hook and fails on tracked env
  files, unrecognised CSVs, credential-shaped strings, and any commit in
  *history* touching a private path.
- Real categorisation rules live in `private/my-rules.ts` (gitignored) because
  their patterns name an employer, a landlord, and specific merchants.
  `scripts/rules.example.ts` is the public template.
- `SIMPLEFIN_ACCESS_URL` is a bearer credential in URL form. `redactUrl()` is
  the only form allowed near a log.

Never commit a real statement, balance, merchant name, or account number — not
in code, not in a test fixture, not in a doc, not in a commit message.

## Design work

The look and feel is deliberate, not a default theme: a **ledger**, not a
dashboard. Ink ground, tabular figures so a column of numbers aligns on the
decimal, and amber reserved exclusively for "a human changed this" — the dotted
underline under a corrected amount, the diamond on a locked category. Do not
spend amber on anything else; its meaning is the point.

`src/app/globals.css` holds the tokens. Read it before restyling anything.

For visual work, these are available and worth using rather than improvising:

- **`frontend-design`** skill — load before building or reshaping any UI.
- **`dataviz`** skill — load *before* writing the first line of chart code.
  The Sankey and the fixed/variable bar chart both fall under it.
- **Figma MCP** is connected on a Full seat. `figma-generate-design` pushes a
  page into Figma from code; `figma-design-to-code` implements a design back as
  code; `figma-generate-library` builds a token/component library. Each has a
  mandatory prerequisite skill — load it first, the tools fail confusingly
  otherwise.

## Commands

```bash
npm run dev              # app on :3000
npm test                 # the whole suite
npm run prepush          # privacy + typecheck + tests + diagrams
npm run sync             # pull from SimpleFIN, categorise, match transfers
npm run recategorize     # re-run rules over a date range, after editing them
npm run import <file>    # a statement the feed cannot reach
npm run seed             # ~230 synthetic transactions to develop against
```

Develop against `npm run seed`, not against real data.
