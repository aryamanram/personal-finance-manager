/** Mirrors db/schema.sql. Keep in sync by hand — schema.sql is authoritative. */

export type AccountType = 'depository' | 'credit' | 'investment' | 'loan' | 'other';
export type TxnStatus = 'pending' | 'posted';
export type CategorySource = 'unset' | 'default' | 'import' | 'rule' | 'llm' | 'manual';
export type CostType = 'fixed' | 'variable';
export type Necessity = 'required' | 'discretionary' | 'income' | 'transfer' | 'investment';
export type IngestSource = 'simplefin' | 'plaid' | 'csv' | 'ofx' | 'manual';

export interface Account {
  id: string;
  institution_id: string | null;
  name: string;
  type: AccountType;
  mask: string | null;
  currency: string;
  external_id: string | null;
  source: IngestSource;
  balance_cents: number | null;
  balance_as_of: Date | null;
  is_active: boolean;
  exclude_from_totals: boolean;
}

export interface Category {
  id: string;
  group_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  default_cost_type: CostType;
  default_necessity: Necessity;
  is_archived: boolean;
  sort_order: number;
}

export interface CategoryWithGroup extends Category {
  group_name: string;
  group_sort_order: number;
}

/** A row of v_transactions. Read eff_* for anything user-facing (I3). */
export interface VTransaction {
  id: string;
  account_id: string;
  amount_cents: number;
  currency: string;
  posted_date: string;
  authorized_date: string | null;
  status: TxnStatus;
  raw_description: string;
  description: string | null;
  merchant_id: string | null;
  amount_cents_override: number | null;
  posted_date_override: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  category_id: string | null;
  category_source: CategorySource;
  category_locked: boolean;
  suggested_category_id: string | null;
  suggested_confidence: string | null;
  cost_type_override: CostType | null;
  necessity_override: Necessity | null;
  transfer_id: string | null;
  destination_account_id: string | null;
  exclude_from_totals: boolean;
  source: IngestSource;
  import_batch_id: string | null;
  external_id: string | null;
  fingerprint: string;
  fingerprint_seq: number;
  superseded_by_id: string | null;
  recurring_series_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;

  // Resolved by the view — these are what the UI reads.
  eff_amount_cents: number;
  eff_posted_date: string;
  eff_description: string;
  is_amount_or_date_edited: boolean;
  eff_cost_type: CostType;
  eff_necessity: Necessity;
  category_name: string | null;
  category_group_name: string | null;
  account_name: string;
  account_type: AccountType;
  counts_as_spending: boolean;
}

export interface MonthlyCashflow {
  month: string;
  income_cents: number | null;
  required_cents: number | null;
  discretionary_cents: number | null;
  invested_cents: number | null;
  fixed_cents: number | null;
  variable_cents: number | null;
  spendable_cents: number | null;
}

/** The canonical shape every ingest source maps to before hitting upsert(). */
export interface CanonicalTxn {
  accountId: string;
  amountCents: number;
  postedDate: string;        // ISO yyyy-mm-dd
  authorizedDate?: string | null;
  status: TxnStatus;
  rawDescription: string;
  externalId?: string | null;
  source: IngestSource;
  importedCategory?: string | null;  // Apple Card CSV supplies one
  currency?: string;
}
