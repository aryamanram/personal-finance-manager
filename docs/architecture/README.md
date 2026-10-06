# Architecture

Four diagrams, each answering one question. Start at the top and go down only as
far as you need — the first one fits on a phone screen, the last one names files.

| | Question it answers | Read it when |
|---|---|---|
| **Level 1** (below) | What is this and what does it talk to? | You are new here |
| [Level 2 — Containers](./containers.md) | What are the moving parts? | You are setting it up or debugging a whole subsystem |
| [Level 3 — Components](./components.md) | Which module does what? | You are about to change code |
| [Data flow](./data-flow.md) | How does one transaction travel? | You are chasing a wrong number |

They follow the [C4 model](https://c4model.com/)'s idea of hierarchical zoom
levels, but use plain Mermaid flowcharts rather than Mermaid's `C4Context`
syntax, which is [documented as
experimental](https://mermaid.js.org/syntax/c4.html) and needs per-element pixel
offsets to lay out. Plain flowcharts render natively on GitHub with no build
step and no toolchain, which is what keeps these diagrams cheap enough to
actually update.

`tests/architecture.test.ts` asserts that every file path, database table, and
npm script named in these documents still exists. Rename a module and the test
tells you which diagram went stale.

---

## Level 1 — System context

One person, their banks, and two outside services.

```mermaid
%%{init: {'theme':'base','themeVariables':{
  'background':'transparent',
  'primaryColor':'#1b2430','primaryTextColor':'#e6eaec','primaryBorderColor':'#34424f',
  'lineColor':'#84919a','secondaryColor':'#131922','tertiaryColor':'#0f141b',
  'clusterBkg':'#0f141b','clusterBorder':'#25303e',
  'edgeLabelBackground':'#0b0f14','fontSize':'14px'
}}}%%
flowchart TB
    owner["<b>You</b><br/><span style='font-size:11px'>the only user</span>"]

    ledger["<b>Ledger</b><br/><span style='font-size:11px'>Self-hosted finance tracker.<br/>Answers: how much can I invest,<br/>and how much of next month<br/>do I already know?</span>"]

    banks[("<b>Your banks</b><br/><span style='font-size:11px'>Chase checking · credit cards<br/>Apple Card · brokerage</span>")]
    simplefin["<b>SimpleFIN Bridge</b><br/><span style='font-size:11px'>Read-only transaction feed.<br/>~24 requests/day.</span>"]

    owner -->|"reads, corrects,<br/>categorises"| ledger
    ledger -->|"pulls daily"| simplefin
    simplefin -->|"read-only"| banks
    owner -->|"exports a statement<br/>when a bank has no feed"| ledger

    classDef person fill:#2f8a72,stroke:#6ee7c0,color:#0b0f14
    classDef core fill:#25303e,stroke:#84919a,color:#e6eaec
    classDef ext fill:#131922,stroke:#34424f,color:#a5b0b7
    class owner person
    class ledger core
    class banks,simplefin ext
```

### What crosses each boundary

| Boundary | What moves | What never moves |
|---|---|---|
| Bridge → Ledger | Dates, amounts, descriptions, balances | Bank credentials — the bridge holds those, this app never sees them |
| Ledger → anywhere else | Nothing | There is no other outbound call |

Categorisation is entirely local. It once sent unknown merchant names to a
language model; that step was retired because every guess is reviewed by hand
anyway, and the owner's own past decisions predict the next one better than a
general model does (`npm run backtest` measures it). Nothing about a
transaction leaves the machine except the bridge's own read-only pull.

### Two things this deliberately is not

**Not multi-user.** No authentication, no tenancy, no row-level security. It
runs on localhost or behind Tailscale. Adding a second user would mean revisiting
every query in `src/lib/queries.ts`.

**Not a source of truth for money.** The bank is. This app reconciles against
`accounts.balance_cents` and shows the drift rather than hiding it, because a
ledger that silently disagrees with your bank is worse than no ledger.

---

Next: [Level 2 — Containers](./containers.md)
