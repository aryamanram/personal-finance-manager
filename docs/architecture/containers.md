# Level 2 — Containers

The separately runnable pieces, and where state lives.

← [Level 1](./README.md) · → [Level 3](./components.md) · [Data flow](./data-flow.md)

```mermaid
%%{init: {'theme':'base','themeVariables':{
  'background':'transparent',
  'primaryColor':'#1f232c','primaryTextColor':'#e8e6e1','primaryBorderColor':'#3a4150',
  'lineColor':'#6b6f78','secondaryColor':'#171a21','tertiaryColor':'#12141a',
  'clusterBkg':'#12141a','clusterBorder':'#2a2f3a',
  'edgeLabelBackground':'#0d0f13','fontSize':'14px'
}}}%%
flowchart TB
    owner(["<b>You</b>"])

    subgraph machine["Your machine"]
        direction TB

        web["<b>Next.js app</b><br/><span style='font-size:11px'>React 19 · Server Components<br/>npm run dev → :3000</span>"]

        subgraph passes["Batch passes · npm scripts · idempotent"]
            direction LR
            sync["<b>sync</b><br/><span style='font-size:11px'>fetch + categorise<br/>+ match</span>"]
            recat["<b>recategorize</b><br/><span style='font-size:11px'>re-run rules over<br/>a date range</span>"]
            importcsv["<b>import</b><br/><span style='font-size:11px'>a statement the<br/>feed cannot reach</span>"]
        end

        db[("<b>PostgreSQL 16</b><br/><span style='font-size:11px'>docker compose · :5433<br/>15 tables · 4 views</span>")]
        envfile["<b>.env.local</b><br/><span style='font-size:11px'>bridge URL · API key<br/>gitignored</span>"]
    end

    bridge["SimpleFIN Bridge"]
    claude["Claude API"]

    owner -->|"browser"| web
    owner -->|"terminal · cron"| passes

    web <-->|"SQL"| db
    passes -->|"SQL"| db
    sync -->|"HTTPS"| bridge
    recat -.->|"unknown merchants"| claude
    sync -.-> claude

    envfile -.->|"read at startup"| web
    envfile -.-> passes

    classDef person fill:#3d6b5c,stroke:#5b9c85,color:#e8e6e1
    classDef app fill:#2a2f3a,stroke:#6b6f78,color:#e8e6e1
    classDef store fill:#1f232c,stroke:#5b9c85,color:#e8e6e1
    classDef ext fill:#171a21,stroke:#3a4150,color:#a8a69f
    classDef secret fill:#1f232c,stroke:#d9a441,color:#d9a441
    class owner person
    class web,sync,recat,importcsv app
    class db store
    class bridge,claude ext
    class envfile secret
```

## The parts

| Container | Runs | Holds state? |
|---|---|---|
| **Next.js app** | `npm run dev`, or `build` + `start` | No — reads and writes Postgres |
| **Batch passes** | `npm run sync` · `recategorize` · `import` · `transfers` | No |
| **PostgreSQL** | `docker compose up -d` | **Yes. Everything.** |
| **`.env.local`** | — | Credentials only. Never committed. |

Postgres is the only durable state. Losing the app is an inconvenience; losing
the database is losing your ledger, because the 90-day bridge window cannot
rebuild history older than that.

## Why the passes are separate from the app

Ingest, categorisation, and transfer matching are three **independent idempotent
passes**, not steps in one function. Each can re-run over any date range without
corrupting state. That separation is what makes the development loop possible:
edit a rule, re-run the categoriser over two years, see what changed. Fusing
them would mean re-fetching from the bridge to re-categorise — and the bridge
allows ~24 requests a day before it disables the token.

Idempotency is not incidental. It is enforced by tests:

- re-importing a statement three times leaves the row count unchanged
- a second sync over the same window inserts nothing
- re-running the categoriser never touches a row a human has locked

## Scheduling

There is no in-process scheduler. `sync` is a plain script so it stays runnable
by hand:

```cron
0 6 * * * cd /path/to/ledger && npm run sync >> sync.log 2>&1
```

Exit codes: `0` ok · `1` failed · `2` partial, one institution broken while
others synced · `3` misconfigured. The distinction matters under cron, where the
exit code is the only thing anyone reads.

## The one configuration trap

`SIMPLEFIN_ACCESS_URL` is a bearer credential **in URL form**: the username and
password are embedded in the URL itself, before the host. Two consequences the
code has to respect:

1. Node's `fetch` refuses a URL carrying credentials, so they are moved to an
   `Authorization` header before the request (`src/ingest/simplefin.ts`).
2. It must never reach a log. `redactUrl()` is the only form allowed near one,
   and a test asserts no error in the sync path interpolates it.

---

Next: [Level 3 — Components](./components.md)
