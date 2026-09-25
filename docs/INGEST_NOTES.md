# Schema companion notes

The algorithms the schema assumes but can't enforce on its own.

## 1. Re-import-safe dedup

The unique index is `(account_id, fingerprint, fingerprint_seq)`. `fingerprint_seq`
auto-increments, so a naive re-import of the same file would happily insert
seq=2,3,4... and silently double your spending. The importer must dedup by
**counting**, not by existence:

```
for each fingerprint group F in the incoming file:
    n_file     = count of rows with fingerprint F in the file
    n_existing = SELECT count(*) FROM transactions
                 WHERE account_id = ? AND fingerprint = F
    insert max(0, n_file - n_existing) rows
```

This is correct whether you re-import August's statement once or five times,
and it still allows two genuinely identical coffees to land.

`fingerprint = sha256(account_id | posted_date | amount_cents | normalize(raw_description))`

`normalize()` should uppercase, strip punctuation, collapse whitespace, and
remove trailing store numbers and transaction refs — those churn between
pending and posted.

When `external_id` is present (SimpleFIN/Plaid), it is authoritative — but you
**cannot** skip the fingerprint check, or a manual CSV backfill will be
double-counted once the API sync window overlaps it. CSV rows have no
`external_id`, so they will never conflict on it. Resolve in three steps:

```
1. Match on (account_id, external_id)        -> UPDATE in place. Done.
2. No match? Look for an ADOPTABLE row:
     same account_id, same fingerprint,
     external_id IS NULL,                    (i.e. it came from a CSV)
     not already adopted this run
   -> UPDATE that row: set external_id, source='simplefin'.
      Do NOT touch its category, overrides, or locks.
3. Still no match? INSERT.
```

Step 2 is "adoption": the CSV row you imported by hand gets claimed by the API
row that describes the same real-world transaction, keeping whatever
categorization you had already done to it. Without it, backfill and sync collide.

**Step 2 is not enough on its own.** It needs the normalized description AND
the date to match exactly, and a bank's feed and its own CSV export routinely
disagree on both — the feed may repeat the merchant's domain and post a day
later. One charge got through as two rows that way, counted twice and
categorized twice (the CSV copy by hand, the synced copy by a rule). So there
is a step 2b:

```
2b. Still no match? Look for a FUZZY adoptable row:
      same account_id,
      EXACTLY the same amount_cents,
      posted_date within 2 days,
      external_id IS NULL,
      and one normalized description is a PREFIX of the other
    -> adopt it exactly as step 2 does.
```

Each condition is carrying weight:

- **Amount is exact.** Merging across amounts would invent a reconciliation
  error, which is the one failure here that corrupts money rather than tidiness.
- **Two days, not five.** Wider starts merging a genuinely repeated charge —
  the same subscription billed twice in a week.
- **Prefix, not substring or edit distance.** A prefix cannot match two
  unrelated merchants; the looser tests can.
- **The comparison runs in TypeScript, not SQL**, because `normalize()` is
  TypeScript. Reimplementing it as a SQL expression would give the ingest path
  two definitions of "the same description" that could drift apart.

Test this explicitly: import a CSV covering a date range, then run a sync whose
window overlaps it, and assert the transaction count equals the union, not the
sum.

## 2. Pending → posted supersession

Pending rows get a new `external_id` when they post, so they look like new
transactions. On each sync, for every incoming posted row, look for an
unmatched pending row where:

- same `account_id`
- `posted_date` within ±5 days
- amount within 25% (restaurant tips and gas pre-auths move a lot)

On match: set the pending row's `superseded_by_id` to the new row and **carry
over `category_id`, `category_source`, `category_locked`, and both overrides**.
Otherwise every categorization you did on a pending transaction evaporates the
moment it posts. Every view filters `superseded_by_id IS NULL`.

## 3. Transfer matching

Your setup generates three recurring transfer pairs: checking → Explorer,
checking → Apple Card, and any checking ↔ savings movement.

```
candidates = pairs (a, b) where
    a.amount_cents = -b.amount_cents
    a.account_id  <> b.account_id
    abs(a.posted_date - b.posted_date) <= 5 days
    both transfer_id IS NULL
score by: date proximity, and whether descriptions match
          /payment|transfer|autopay|thank you/i
```

Above ~0.90 confidence, auto-link. Below, queue for review — a one-click
"these are the same" button in the UI writes `matched_by = 'manual'`.

The Apple Card is the awkward one: it syncs monthly by file while Chase syncs
daily, so the two legs of an Apple Card payment can arrive weeks apart. Either
widen the window for that account specifically, or re-run the matcher after
every CSV import rather than only after API syncs.

## 4. The rule the recategorizer must never break

```sql
UPDATE transactions SET category_id = ?, category_source = 'rule'
WHERE ... AND NOT category_locked;
```

The `NOT category_locked` guard is the whole point of the trigger. Write it
into every batch categorization path — nightly rules pass, LLM backfill,
merchant-default propagation, all of them.

## 5. Two axes, not one

`cost_type` (fixed/variable) answers *is this predictable?*
`necessity` (required/discretionary) answers *can I cut it?*

They cross independently:

|              | required            | discretionary        |
|--------------|--------------------|----------------------|
| **fixed**    | rent, insurance    | Netflix, gym         |
| **variable** | groceries, gas     | restaurants, travel  |

Your investable number comes off the necessity axis (`income − required`).
Your forecasting confidence comes off the cost axis (fixed costs are the part
of next month you already know). Collapsing them into one toggle loses one of
those questions, which is why the schema carries both.

## 6. Credit cards: why purchases are the spending record

A card is a pass-through. Money is spent at a merchant, and later the same
money leaves checking to settle the balance. Only one of those is spending.

This ledger counts the **purchase** — that is where the money actually went,
and it carries the merchant, the date and the detail that categorisation needs.
The settling payment is matched as a transfer (§3), so `counts_as_spending` is
false on both legs and a $60 dinner is not also $60 of "Credit Card Payment".
The payments need no category; they exist as evidence, not as spending.

That choice is only sound while the cards are actually being paid off. A
carried balance would mean purchases claim money that never left the bank. The
identity that rules it out, per card:

    purchases − payments_applied = still_owed = what the issuer reports

`getCardSettlement()` computes it and the dashboard states it outright, because
"no warning" and "not checked" look identical.

**Only posted payments count as applied.** A payment the issuer has received
but not yet applied still sits in the ledger, but the reported balance does not
know about it — counting it makes a card look overpaid by the amount in flight.
This is not hypothetical: a card paid off in full and still pending two days
later made the ledger claim a zero balance while the issuer still wanted the
full amount, which surfaced as a phantom reconciliation gap of exactly the
payment's size on a card that was reconciling to the cent. Pending payments
are reported separately as `clearing_cents`.

The same timing problem breaks naive reconciliation, and differently per
institution: **this ledger's checking balance includes its pending rows and its
cards' balances do not.** `getReconciliation()` therefore tests both bases and
reports an account only when neither matches. Picking one invents drift on
every account that uses the other.

`tests/card-settlement.test.ts` asserts the arithmetic, in both directions: a
settled card, a card paid down in steps, a payment still clearing, a card
carrying more than the ledger explains, and a payment the issuer never saw.
