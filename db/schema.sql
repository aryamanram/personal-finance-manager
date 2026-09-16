-- ============================================================================
-- Personal finance tracker — core schema (PostgreSQL 14+)
--
-- Design invariants:
--   1. Money is BIGINT cents. Never float, never numeric-with-rounding-surprises.
--   2. Sign is from the ACCOUNT's perspective: negative = outflow, positive = inflow.
--      Credit card purchase => negative. Payment TO the card => positive.
--   3. Machine categorization NEVER overwrites a human decision.
--   4. Fixed/variable and required/discretionary are ORTHOGONAL axes, not one flag.
--   5. Transfers are paired and excluded from spend totals.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy merchant matching

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE account_type AS ENUM (
  'depository',   -- Chase checking / savings
  'credit',       -- Chase Explorer, Apple Card
  'investment',
  'loan',
  'other'
);

CREATE TYPE txn_status AS ENUM ('pending', 'posted');

-- Where the current category assignment came from. Ordering matters:
-- anything below 'manual' may be overwritten by a recategorization pass.
CREATE TYPE category_source AS ENUM (
  'unset',
  'default',   -- fallback bucket
  'import',    -- category supplied by the source file (Apple Card CSV has one)
  'rule',      -- deterministic rule matched
  'llm',       -- model-assigned
  'manual'     -- you said so. sacred.
);

-- Axis 1: does the AMOUNT vary month to month?
CREATE TYPE cost_type AS ENUM ('fixed', 'variable');

-- Axis 2: can you actually cut it?
CREATE TYPE necessity AS ENUM (
  'required',        -- rent, insurance, groceries, utilities
  'discretionary',   -- restaurants, travel, hobbies
  'income',
  'transfer',        -- moves between your own accounts; not spending
  'investment'       -- outbound to brokerage/retirement; not spending, not expense
);

CREATE TYPE ingest_source AS ENUM ('simplefin', 'plaid', 'csv', 'ofx', 'manual');

-- ---------------------------------------------------------------------------
-- Institutions & accounts
-- ---------------------------------------------------------------------------

CREATE TABLE institutions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  source        ingest_source NOT NULL,
  external_id   TEXT,               -- SimpleFIN org id / Plaid institution_id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id     UUID REFERENCES institutions(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,          -- "Chase Total Checking"
  type               account_type NOT NULL,
  mask               TEXT,                   -- last 4, display only
  currency           CHAR(3) NOT NULL DEFAULT 'USD',

  external_id        TEXT,                   -- stable id from the aggregator
  source             ingest_source NOT NULL,

  -- Cached balance from the last sync. Derived state; transactions are truth.
  balance_cents      BIGINT,
  balance_as_of      TIMESTAMPTZ,

  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  -- Exclude an account entirely from net-worth/spend rollups without deleting it
  exclude_from_totals BOOLEAN NOT NULL DEFAULT FALSE,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX accounts_external_uniq
  ON accounts (institution_id, external_id)
  WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Categories  (two-level, like Monarch: group > category)
-- ---------------------------------------------------------------------------

CREATE TABLE category_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  sort_order  INT  NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES category_groups(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  icon        TEXT,
  color       TEXT,

  -- Defaults inherited by transactions in this category.
  -- Per-transaction overrides live on the transaction and win.
  default_cost_type  cost_type NOT NULL DEFAULT 'variable',
  default_necessity  necessity NOT NULL DEFAULT 'discretionary',

  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT NOT NULL DEFAULT 0,

  UNIQUE (group_id, name)
);

-- ---------------------------------------------------------------------------
-- Merchants — normalized payee names, so rules and LLM calls are cached per
-- merchant instead of re-run per transaction.
-- ---------------------------------------------------------------------------

CREATE TABLE merchants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name     TEXT NOT NULL UNIQUE,   -- "starbucks"
  display_name        TEXT NOT NULL,          -- "Starbucks"
  -- Once you set this, every future txn from this merchant lands here.
  default_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  logo_url            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX merchants_trgm ON merchants USING gin (normalized_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Transfers — the pairing record. Both legs point at the same transfer row.
-- ---------------------------------------------------------------------------

CREATE TABLE transfers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matched_by  TEXT NOT NULL CHECK (matched_by IN ('auto', 'manual')),
  confidence  NUMERIC(3,2),          -- auto-matcher score, NULL when manual
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Import batches — every ingest run, file-based or API-based.
-- This is what makes the Apple Card CSV path first-class and re-runnable.
-- ---------------------------------------------------------------------------

CREATE TABLE import_batches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID REFERENCES accounts(id) ON DELETE CASCADE,
  source         ingest_source NOT NULL,
  filename       TEXT,                       -- "Apple Card Statement - Aug 2026.csv"
  file_sha256    TEXT,                       -- re-importing the same file is a no-op
  period_start   DATE,
  period_end     DATE,
  rows_seen      INT NOT NULL DEFAULT 0,
  rows_inserted  INT NOT NULL DEFAULT 0,
  rows_duplicate INT NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','ok','failed')),
  error          TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX import_batches_file_uniq
  ON import_batches (account_id, file_sha256)
  WHERE file_sha256 IS NOT NULL AND status = 'ok';

-- ---------------------------------------------------------------------------
-- Transactions — the core table
-- ---------------------------------------------------------------------------

CREATE TABLE transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Money. amount_cents is the RAW value from the source and is never mutated
  -- after insert -- it's what lets you reconcile against the bank's balance.
  -- User corrections live in amount_cents_override.
  amount_cents    BIGINT NOT NULL,        -- signed; negative = outflow
  currency        CHAR(3) NOT NULL DEFAULT 'USD',

  -- Dates. posted_date drives all reporting; authorized_date is when you swiped.
  posted_date     DATE NOT NULL,
  authorized_date DATE,

  status          txn_status NOT NULL DEFAULT 'posted',

  -- Description: keep the raw string forever, it's your audit trail.
  raw_description TEXT NOT NULL,
  description     TEXT,                    -- cleaned, user-editable display text
  merchant_id     UUID REFERENCES merchants(id) ON DELETE SET NULL,

  -- --- User override layer --------------------------------------------------
  -- NULL means "use the raw synced value". Non-NULL means you corrected it.
  -- Reporting reads eff_* from v_transactions; reconciliation reads the raw
  -- columns above. Never resolve these in application code -- use the view.
  amount_cents_override  BIGINT,
  posted_date_override   DATE,
  -- Set TRUE when you void a row entirely (OCR double-read, duplicate import).
  -- Preserved rather than deleted so re-imports don't resurrect it.
  voided_at              TIMESTAMPTZ,
  void_reason            TEXT,

  -- --- Categorization -------------------------------------------------------
  category_id           UUID REFERENCES categories(id) ON DELETE SET NULL,
  category_source       category_source NOT NULL DEFAULT 'unset',
  -- Set TRUE the moment a human touches it. The recategorizer must respect it.
  category_locked       BOOLEAN NOT NULL DEFAULT FALSE,
  -- What the machine *would* have said. Keeps a feedback signal for rule tuning
  -- without clobbering your choice.
  suggested_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  suggested_confidence  NUMERIC(3,2),

  -- --- Fixed/variable + required/discretionary overrides ---------------------
  -- NULL means "inherit from the category". Non-NULL means you overrode it
  -- for this one transaction.
  cost_type_override  cost_type,
  necessity_override  necessity,

  -- --- Transfers & exclusions ----------------------------------------------
  transfer_id         UUID REFERENCES transfers(id) ON DELETE SET NULL,
  -- Where an investment contribution went. NOT a transfer pair: the brokerage
  -- is snapshot-tracked and has no transaction rows, so there is no second leg.
  destination_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  -- Manual escape hatch: reimbursements, fraud, duplicates you don't want to delete
  exclude_from_totals BOOLEAN NOT NULL DEFAULT FALSE,

  -- --- Dedup / provenance ---------------------------------------------------
  source           ingest_source NOT NULL,
  import_batch_id  UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  external_id      TEXT,                   -- aggregator id; absent for CSV

  -- sha256(account_id | posted_date | amount_cents | normalized raw_description)
  fingerprint      TEXT NOT NULL,
  -- Two identical $4.50 coffees on the same day are NOT duplicates.
  -- Auto-assigned by trigger (1,2,3...) within a fingerprint group, so no
  -- insert path has to remember it. See the importer algorithm in README.
  fingerprint_seq  INT,

  -- Pending rows get superseded by their posted version rather than deleted.
  superseded_by_id UUID REFERENCES transactions(id) ON DELETE SET NULL,

  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT amount_nonzero CHECK (amount_cents <> 0)
);

-- Aggregator ids are authoritative when present.
CREATE UNIQUE INDEX txn_external_uniq
  ON transactions (account_id, external_id)
  WHERE external_id IS NOT NULL;

-- Fingerprint + seq is the dedup key for file imports.
CREATE UNIQUE INDEX txn_fingerprint_uniq
  ON transactions (account_id, fingerprint, fingerprint_seq);

CREATE INDEX txn_account_date   ON transactions (account_id, posted_date DESC);
CREATE INDEX txn_date           ON transactions (posted_date DESC);
CREATE INDEX txn_category       ON transactions (category_id);
CREATE INDEX txn_merchant       ON transactions (merchant_id);
CREATE INDEX txn_transfer       ON transactions (transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX txn_destination    ON transactions (destination_account_id)
  WHERE destination_account_id IS NOT NULL;
CREATE INDEX txn_uncategorized  ON transactions (posted_date DESC)
  WHERE category_id IS NULL AND superseded_by_id IS NULL;

-- ---------------------------------------------------------------------------
-- Edit log — every manual change, for undo and for "why is this number weird?"
-- ---------------------------------------------------------------------------

CREATE TABLE transaction_edits (
  id             BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  field          TEXT NOT NULL,       -- 'category_id' | 'amount_cents' | ...
  old_value      TEXT,
  new_value      TEXT,
  edited_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX txn_edits_txn ON transaction_edits (transaction_id, edited_at DESC);


CREATE OR REPLACE FUNCTION transactions_before_write() RETURNS TRIGGER AS $$
BEGIN
  -- A human touched the category => freeze it against every machine pass.
  IF NEW.category_source = 'manual' THEN
    NEW.category_locked := TRUE;
  END IF;

  -- Auto-assign the occurrence number within a fingerprint group so that
  -- legitimately identical transactions (two $4.50 coffees, same day, same
  -- merchant) can coexist without the caller tracking sequence numbers.
  IF TG_OP = 'INSERT' AND NEW.fingerprint_seq IS NULL THEN
    SELECT COALESCE(MAX(fingerprint_seq), 0) + 1
      INTO NEW.fingerprint_seq
      FROM transactions
     WHERE account_id  = NEW.account_id
       AND fingerprint = NEW.fingerprint;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transactions_before_write
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_before_write();

-- ---------------------------------------------------------------------------
-- Rules — deterministic categorization, evaluated in priority order
-- ---------------------------------------------------------------------------

CREATE TABLE rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  priority       INT  NOT NULL DEFAULT 100,   -- lower runs first
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,

  -- Conditions (all non-NULL ones must match)
  match_regex        TEXT,        -- against raw_description
  match_account_id   UUID REFERENCES accounts(id) ON DELETE CASCADE,
  match_amount_min   BIGINT,
  match_amount_max   BIGINT,

  -- Actions
  set_category_id    UUID REFERENCES categories(id) ON DELETE CASCADE,
  set_merchant_id    UUID REFERENCES merchants(id) ON DELETE SET NULL,
  set_cost_type      cost_type,
  set_necessity      necessity,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rules_priority ON rules (priority) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Recurring series — powers "fixed cost" detection and next-charge forecasting
-- ---------------------------------------------------------------------------

CREATE TABLE recurring_series (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       UUID REFERENCES merchants(id) ON DELETE CASCADE,
  account_id        UUID REFERENCES accounts(id) ON DELETE CASCADE,
  category_id       UUID REFERENCES categories(id) ON DELETE SET NULL,
  cadence           TEXT NOT NULL CHECK (cadence IN
                      ('weekly','biweekly','monthly','quarterly','annual')),
  expected_cents    BIGINT NOT NULL,
  tolerance_cents   BIGINT NOT NULL DEFAULT 500,
  next_expected_on  DATE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE transactions
  ADD COLUMN recurring_series_id UUID REFERENCES recurring_series(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Budgets — monthly target per category
-- ---------------------------------------------------------------------------

CREATE TABLE budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period_month  DATE NOT NULL,             -- always the 1st of the month
  amount_cents  BIGINT NOT NULL,
  UNIQUE (category_id, period_month),
  CONSTRAINT period_is_month_start CHECK (EXTRACT(DAY FROM period_month) = 1)
);

-- ---------------------------------------------------------------------------
-- Sync runs — observability for the automated path
-- ---------------------------------------------------------------------------

CREATE TABLE sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        ingest_source NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','ok','partial','failed')),
  accounts_synced INT NOT NULL DEFAULT 0,
  txns_inserted   INT NOT NULL DEFAULT 0,
  txns_updated    INT NOT NULL DEFAULT 0,
  error           TEXT
);

-- ============================================================================
-- Views — where the overrides actually resolve
-- ============================================================================

-- Every transaction with its effective cost_type / necessity resolved.
-- Query this, never the raw table, for anything user-facing.
CREATE VIEW v_transactions AS
SELECT
  t.*,
  -- Effective values: user correction wins, raw synced value is the fallback.
  -- ALWAYS read these, never t.amount_cents, outside of reconciliation.
  COALESCE(t.amount_cents_override, t.amount_cents)                   AS eff_amount_cents,
  COALESCE(t.posted_date_override,  t.posted_date)                    AS eff_posted_date,
  COALESCE(NULLIF(t.description,''), t.raw_description)               AS eff_description,
  (t.amount_cents_override IS NOT NULL
   OR t.posted_date_override IS NOT NULL)                             AS is_amount_or_date_edited,
  COALESCE(t.cost_type_override, c.default_cost_type, 'variable')      AS eff_cost_type,
  COALESCE(t.necessity_override, c.default_necessity, 'discretionary') AS eff_necessity,
  c.name       AS category_name,
  cg.name      AS category_group_name,
  a.name       AS account_name,
  a.type       AS account_type,
  -- The single predicate for "does this count as spending?"
  (t.transfer_id IS NULL
   AND NOT t.exclude_from_totals
   AND NOT a.exclude_from_totals
   AND t.superseded_by_id IS NULL
   AND t.voided_at IS NULL
   AND t.status = 'posted'
   AND COALESCE(t.necessity_override, c.default_necessity)
       NOT IN ('transfer','income','investment'))                      AS counts_as_spending
FROM transactions t
JOIN accounts a          ON a.id = t.account_id
LEFT JOIN categories c   ON c.id = t.category_id
LEFT JOIN category_groups cg ON cg.id = c.group_id;

-- The headline number you're actually after:
--   income - required = what you're free to allocate
--   that minus discretionary spend = what's genuinely investable
CREATE VIEW v_monthly_cashflow AS
SELECT
  date_trunc('month', eff_posted_date)::date AS month,
  SUM(eff_amount_cents) FILTER (
    WHERE eff_necessity = 'income' AND voided_at IS NULL
      AND superseded_by_id IS NULL)                       AS income_cents,
  -SUM(eff_amount_cents) FILTER (
    WHERE counts_as_spending AND eff_necessity = 'required')      AS required_cents,
  -SUM(eff_amount_cents) FILTER (
    WHERE counts_as_spending AND eff_necessity = 'discretionary') AS discretionary_cents,
  -SUM(eff_amount_cents) FILTER (
    WHERE eff_necessity = 'investment' AND voided_at IS NULL
      AND superseded_by_id IS NULL)                       AS invested_cents,
  -- fixed vs variable cut across the same rows, independently
  -SUM(eff_amount_cents) FILTER (
    WHERE counts_as_spending AND eff_cost_type = 'fixed')    AS fixed_cents,
  -SUM(eff_amount_cents) FILTER (
    WHERE counts_as_spending AND eff_cost_type = 'variable')  AS variable_cents,
  -- income minus required = your true spendable/investable pool
  COALESCE(SUM(eff_amount_cents) FILTER (
      WHERE eff_necessity = 'income' AND voided_at IS NULL
        AND superseded_by_id IS NULL), 0)
    + COALESCE(SUM(eff_amount_cents) FILTER (
        WHERE counts_as_spending AND eff_necessity = 'required'), 0)
                                                          AS spendable_cents
FROM v_transactions
GROUP BY 1
ORDER BY 1 DESC;

-- ============================================================================
-- Seed: categories tuned to a Chase checking + 2 credit card setup
-- ============================================================================

INSERT INTO category_groups (name, sort_order) VALUES
  ('Income', 10), ('Housing', 20), ('Transportation', 30), ('Food', 40),
  ('Health', 50), ('Lifestyle', 60), ('Financial', 70), ('Transfers', 99);

INSERT INTO categories (group_id, name, default_cost_type, default_necessity)
SELECT g.id, v.name, v.ct::cost_type, v.nec::necessity
FROM (VALUES
  ('Income','Paycheck','fixed','income'),
  ('Income','Interest & Dividends','variable','income'),
  ('Income','Reimbursement','variable','income'),

  ('Housing','Rent','fixed','required'),
  ('Housing','Utilities','variable','required'),
  ('Housing','Internet & Phone','fixed','required'),
  ('Housing','Renters Insurance','fixed','required'),
  ('Housing','Home Goods','variable','discretionary'),

  ('Transportation','Car Payment','fixed','required'),
  ('Transportation','Auto Insurance','fixed','required'),
  ('Transportation','Gas','variable','required'),
  ('Transportation','Parking & Tolls','variable','required'),
  ('Transportation','Rideshare','variable','discretionary'),
  ('Transportation','Flights','variable','discretionary'),

  ('Food','Groceries','variable','required'),
  ('Food','Restaurants','variable','discretionary'),
  ('Food','Coffee','variable','discretionary'),

  ('Health','Insurance Premium','fixed','required'),
  ('Health','Pharmacy','variable','required'),
  ('Health','Fitness','fixed','discretionary'),

  ('Lifestyle','Subscriptions','fixed','discretionary'),
  ('Lifestyle','Shopping','variable','discretionary'),
  ('Lifestyle','Entertainment','variable','discretionary'),
  ('Lifestyle','Travel','variable','discretionary'),
  ('Lifestyle','Gifts','variable','discretionary'),

  ('Financial','Tuition','fixed','required'),
  ('Financial','Student Loan','fixed','required'),
  ('Financial','Brokerage Contribution','variable','investment'),
  ('Financial','Retirement Contribution','fixed','investment'),
  ('Financial','Fees & Interest','variable','required'),
  ('Financial','Taxes','variable','required'),

  ('Transfers','Credit Card Payment','variable','transfer'),
  ('Transfers','Account Transfer','variable','transfer'),

  -- Cash that left the account but whose destination the ledger cannot see.
  -- Deliberately NOT Uncategorized: that means "nobody has decided yet", while
  -- this means "decided, and unknowable". Counts as spending either way.
  ('Lifestyle','Cash Withdrawn','variable','discretionary'),

  ('Lifestyle','Uncategorized','variable','discretionary')
) AS v(grp, name, ct, nec)
JOIN category_groups g ON g.name = v.grp;

-- ============================================================================
-- Investment accounts
--
-- Deliberately SEPARATE from the transaction ledger. An investment account's
-- VALUE moves with the market; that movement is neither income nor spending and
-- must never touch v_monthly_cashflow. What DOES belong in the cashflow ledger
-- is the contribution -- money leaving checking, categorized with
-- necessity = 'investment'.
--
--   "I put $2,000 into Morgan Stanley"  -> a transaction on Chase checking
--   "The account is worth $X today"     -> a balance_snapshot
--
-- Conflating these is how a good month in the market shows up as income.
-- ============================================================================

CREATE TABLE balance_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of         DATE NOT NULL,
  balance_cents BIGINT NOT NULL,
  source        ingest_source NOT NULL DEFAULT 'manual',
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, as_of)
);

CREATE INDEX balance_snapshots_acct_date
  ON balance_snapshots (account_id, as_of DESC);

-- Optional, and only populated if the aggregator returns a holdings array.
-- SimpleFIN provides: symbol, description, shares, cost_basis, market_value.
-- Skip this table entirely if you only want account-level net worth.
CREATE TABLE holdings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of             DATE NOT NULL,
  symbol            TEXT,
  description       TEXT,
  shares            NUMERIC(20,8),
  cost_basis_cents  BIGINT,
  market_value_cents BIGINT,
  external_id       TEXT,
  UNIQUE (account_id, as_of, symbol)
);

-- Net worth over time, from snapshots plus derived cash balances.
-- Investment accounts contribute their snapshot value; everything else
-- contributes its running transaction total.
CREATE VIEW v_net_worth AS
WITH snapshot_accounts AS (
  SELECT DISTINCT ON (bs.account_id) bs.account_id, bs.as_of, bs.balance_cents
  FROM balance_snapshots bs
  ORDER BY bs.account_id, bs.as_of DESC
),
ledger_accounts AS (
  SELECT t.account_id, SUM(t.eff_amount_cents) AS balance_cents
  FROM v_transactions t
  WHERE t.voided_at IS NULL AND t.superseded_by_id IS NULL
  GROUP BY t.account_id
)
SELECT
  a.id AS account_id,
  a.name,
  a.type,
  COALESCE(s.balance_cents, l.balance_cents, 0) AS balance_cents,
  CASE WHEN s.account_id IS NOT NULL THEN 'snapshot' ELSE 'ledger' END AS basis,
  s.as_of AS snapshot_date
FROM accounts a
LEFT JOIN snapshot_accounts s ON s.account_id = a.id
LEFT JOIN ledger_accounts   l ON l.account_id = a.id
WHERE a.is_active;

-- ============================================================================
-- Linking contributions to their destination account
--
-- A "Brokerage Contribution" on checking is an outflow, but the ledger doesn't
-- otherwise know WHERE it went. This link is what lets the transaction list
-- show "sent to investment" as an expandable row revealing how that account is
-- actually doing.
--
-- Note this is NOT a transfer pair: the Morgan Stanley side has no transaction
-- rows (it's snapshot-tracked), so there is no second leg to match. The
-- contribution correctly stays in the ledger as an outflow with
-- necessity = 'investment' -- money you committed, not money you spent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Investment performance
--
-- Growth is measured against the FIRST snapshot, not against zero. Money that
-- was in the account before tracking began is a starting position, not a gain.
--
--   gain = current_value - opening_value - contributions_since_opening
--
-- The percentage is deliberately Modified Dietz rather than a naive
-- (end-start)/start, which misattributes contributions as performance. Dietz
-- weights each contribution by the fraction of the period it was invested.
-- It is an approximation, but an honest one; naive return is neither.
-- ---------------------------------------------------------------------------

CREATE VIEW v_investment_performance AS
WITH bounds AS (
  SELECT
    account_id,
    MIN(as_of) AS opening_date,
    MAX(as_of) AS current_date_
  FROM balance_snapshots
  GROUP BY account_id
),
vals AS (
  SELECT
    b.account_id,
    b.opening_date,
    b.current_date_,
    (SELECT balance_cents FROM balance_snapshots s
      WHERE s.account_id = b.account_id AND s.as_of = b.opening_date)  AS opening_cents,
    (SELECT balance_cents FROM balance_snapshots s
      WHERE s.account_id = b.account_id AND s.as_of = b.current_date_) AS current_cents
  FROM bounds b
),
contribs AS (
  SELECT
    t.destination_account_id AS account_id,
    -SUM(t.eff_amount_cents) AS contributed_cents,
    -- Dietz weight: fraction of the period each dollar was actually invested
    -- date - date yields integer days in Postgres
    SUM( -t.eff_amount_cents *
         ((v.current_date_ - t.eff_posted_date)::numeric
          / NULLIF((v.current_date_ - v.opening_date)::numeric, 0))
    ) AS weighted_contrib_cents
  FROM v_transactions t
  JOIN vals v ON v.account_id = t.destination_account_id
  WHERE t.destination_account_id IS NOT NULL
    AND t.voided_at IS NULL
    AND t.superseded_by_id IS NULL
    AND t.eff_posted_date > v.opening_date
    AND t.eff_posted_date <= v.current_date_
  GROUP BY t.destination_account_id
)
SELECT
  a.id   AS account_id,
  a.name,
  v.opening_date,
  v.opening_cents,
  v.current_date_ AS as_of,
  v.current_cents,
  COALESCE(c.contributed_cents, 0)                                AS contributed_cents,
  v.current_cents - v.opening_cents - COALESCE(c.contributed_cents, 0)
                                                                  AS gain_cents,
  -- Modified Dietz: gain / (opening + time-weighted contributions)
  ROUND(
    100.0 * (v.current_cents - v.opening_cents - COALESCE(c.contributed_cents, 0))
    / NULLIF(v.opening_cents + COALESCE(c.weighted_contrib_cents, 0), 0)
  , 2)                                                            AS return_pct
FROM accounts a
JOIN vals v      ON v.account_id = a.id
LEFT JOIN contribs c ON c.account_id = a.id
WHERE a.type = 'investment';
