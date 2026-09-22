# Categorization, in depth

`DESIGN.md` §8 defines the pipeline. This document is the layer under it: what
data actually arrives, what can be decided without guessing, and how far the
detail can go before a human has to supply it.

Written after measuring the real ledger (396 transactions, Sep 2024 – Sep 2026)
and probing the live SimpleFIN bridge. Every number below came from that
ledger, not from an estimate.

---

## 1. The ceiling: no feed carries product detail

**MCC is per-merchant, not per-product.** A merchant is assigned one 4-digit
code when it starts accepting cards. A hobby shop is `5945` whether the basket
held a booster box or a pack of dice. ISO 18245 has 280 official codes; none of
them describe a product.

**Level 3 card data does carry SKUs — and is unreachable.** It exists only on
corporate and purchasing cards, and it flows merchant → acquirer to reduce
interchange. It never travels back toward the cardholder.

So the honest statement is: **no bank feed will ever say "MTG collector booster
boxes."** Item-level truth has to be entered once by a human and then reused.
The pipeline's job is to make that the rare case, and to make it cheap when it
happens.

### What the bridge actually sends

Probed live against the SimpleFIN bridge over a 14-day window, 19 transactions.
The response carries three fields absent from our own type definition:

| Field | Populated | Verdict |
|---|---|---|
| `payee` | **19/19** | A bank-normalized merchant name. Shorter than the descriptor on every sampled row — one 42-character descriptor arrives as 7 characters. |
| `mcc` | **0/19** | Present in the response, empty in practice. The upstream aggregator does not supply it. |
| `memo` | 0/19 | Empty here. |

SimpleFIN has an open proposal to add an optional MCC field to the protocol.
Optional means servers choose, and this one already answers empty, so treat MCC
as unavailable until a probe says otherwise. **Do not vendor an MCC lookup
table for a column that is always null.**

---

## 2. Signals that arrive and are currently discarded

Each of these is free, already received, and needs no model.

| Source | Field | Current fate |
|---|---|---|
| SimpleFIN | `payee` | Not in `SimpleFinTransaction`; dropped on every sync |
| Chase CSV | `Type` | Parsed by `chase-csv.ts`, then dropped — `CanonicalTxn` has no field |
| Apple CSV | `Merchant` | Treated as a *fallback* for `Description` in `DESC_KEYS` |
| Apple CSV | `Category` | Read into `importedCategory`; no column exists to hold it |

Chase's `Type` is the most immediately valuable, because several values map to
a category with certainty rather than likelihood:

| `Type` | Outflow rows | Means |
|---|---:|---|
| `DEBIT_CARD` | 172 | card purchase — still needs a merchant |
| `MISC_DEBIT` | 34 | — |
| `ACH_DEBIT` | 29 | — |
| `FEE_TRANSACTION` | 17 | **Fees & Interest**, certain |
| `QUICKPAY_DEBIT` | 13 | **Zelle**, certain |
| `ATM` | 11 | **Cash Withdrawn**, certain |
| `LOAN_PMT` | 3 | **Student Loan**, certain |

`QUICKPAY_DEBIT` deserves particular attention: identifying the Zelle rail
structurally is exactly what would have prevented the misrouting that hid
several thousand dollars of spending in `Account Transfer`.

Beyond the columns, the descriptors themselves carry standardised structure:
NACHA SEC codes (`PPD`/`CCD`/`WEB`/`TEL`), originator IDs (`CO ID`), and card
facilitator prefixes (`SQ *`, `TST*`, `AMZN Mktp`), which Visa requires rather
than merely tolerates. Measured on the current ledger: 74 rows carry a company
ID, 42 an aggregator prefix.

---

## 3. The shape of the problem

Two measurements decide the design.

**Breadth.** The largest discretionary category holds **44% of all spending
across 42 merchants** — one bucket. Inside it sit several unrelated kinds of
purchase: consumer electronics, camera equipment, clothing, a hobby-goods
habit bought on instalments, and second-hand shopping paid peer-to-peer. Those
are different decisions wearing one label, and "should I cut this?" cannot be
answered at that resolution.

**The tail.** **125 of 175 merchants appear exactly once**, and those one-off
merchants carry **46% of all spending**.

The tail is the constraint that shapes everything. Merchant memory — the
mechanism that makes recurring spending effortless — covers only the other 50
merchants. Half the money flows through merchants that will never be seen
again, so a design premised on "the system learns your habits" would miss half
the ledger. Entering detail for a one-off has to be *fast*, because it will
never be amortised over a second transaction.

---

## 4. The four tiers

Ordered by trust. Each tier may overwrite the tiers below it and never the ones
above; every tier skips `category_locked` rows (I4).

### Tier 0 — Structural. Deterministic, no guessing.

Facts about the rail, not inferences about the merchant: Chase `Type`, SEC
codes, `CO ID`, facilitator prefixes. An ATM withdrawal is `Cash Withdrawn`
because of what it *is*, not because a model recognised the text.

This tier is new, and it is where the Zelle/PayPal/Venmo rails belong — the
place `STATE.md` records the LLM reliably getting them wrong.

### Tier 1 — Memory. Deterministic, human-derived.

`merchants.default_category_id`, as today. It encodes a past human decision, so
it outranks any machine opinion. Keyed on `payee` once that is captured, which
is more stable than matching a descriptor that drifts with formatting.

### Tier 2 — LLM. Always provisional.

**The guarantee is structural, not statistical.** Confidence cannot carry it:
the peer-payment misrouting recorded in `STATE.md` was almost certainly
high-confidence and wrong. Measured distribution on the current ledger — 51.7% at ≥0.90, only 7.6%
below 0.70 — shows the model is rarely *uncertain*, which is precisely why
uncertainty is a poor filter.

What holds instead:

- an LLM row is never `category_locked`, so Tiers 0 and 1 overwrite it on the
  next pass without a migration or a manual undo;
- the register marks it as a guess, so it is never mistaken for a decision;
- `suggested_category_id` is recorded even when a lock prevents applying it,
  which is the signal for finding rules worth promoting to Tier 0.

Low confidence still earns a place in the review queue — it is a useful
*prioritiser*. It is not a correctness guarantee, and must never be described
as one.

### Tier 3 — Human. The only route to product detail.

A nullable **sub-category** on the transaction, free text with autocomplete
over past values. `Shopping → Electronics`, `Shopping → MTG cards`.

Deliberately not a fixed taxonomy: with 125 one-off merchants, every new kind
of purchase would otherwise demand a schema change. Deliberately not tags
either — one value per row keeps totals unambiguous. Autocomplete converges the
vocabulary without enforcing it.

The 35-category taxonomy stays exactly as it is. Sub-category is a second axis
beneath it, so budgeting and reconciliation are untouched while detail grows
where it is actually wanted.

---

## 5. What this does not do

- **It does not reach SKUs.** Nothing here distinguishes two purchases at the
  same merchant on the same day. Only a receipt could, and receipts do not
  travel over the banking rails.
- **It does not make the LLM trustworthy.** It makes the LLM *correctable*,
  which is a different and more achievable property.
- **Amazon order history is not a route here.** It is the standard advice for
  item-level data, and this ledger holds exactly **one** Amazon transaction.
  The instalment purchases went through a payment processor that exports no
  line items at all.
