---
description: Update docs/STATE.md so the next session can pick up cleanly
---

Bring `docs/STATE.md` up to date with what has actually happened in this session.

Work from evidence, not memory:

1. `git log --oneline main..HEAD` and `git status --short` — what changed
2. `npm test 2>&1 | tail -3` — the real test count, not a remembered one
3. `gh pr list --state open` — anything awaiting review

Then edit `docs/STATE.md`:

- **"Right now"** — rewrite it. Set the date to today. Keep it to a few lines:
  what is in flight, what is blocked, what the next person should pick up. If
  nothing is in flight, say so plainly rather than padding it.
- **"Decisions worth not relitigating"** — add anything settled this session that
  someone would otherwise re-derive or re-argue. Include the *why*, since a
  decision without its reason gets overturned by the next person with an opinion.
- **"Open questions"** — add anything deliberately left undecided, and remove
  anything now answered.
- Correct any stat that has drifted (transaction count, test count, accounts).

Rules:

- Do not invent progress. If something was attempted and abandoned, say that.
- Do not write a changelog — git already has one. Write what someone needs to
  *know*, not what happened.
- Never put a real merchant, balance, account number, or credential in this file.
- Commit the update with whatever work it describes, not as a separate commit.
