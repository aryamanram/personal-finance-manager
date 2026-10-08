/**
 * Story data. Synthetic, and the same synthetic data the demo ledger seeds
 * (scripts/seed-demo.ts, SEED_TODAY 2026-09-28), so a story and the page it
 * comes from on :3001 show the same numbers. Never put a real merchant,
 * amount or account here — this file is public.
 */
import type { CategoryBreakdownRow } from '@/lib/queries';
import { buildPeriods } from '@/lib/periods';
import type {
  CategoryWithGroup, CostType, MonthlyCashflow, Necessity, VTransaction,
} from '@/lib/types';

// --- Categories: the schema's own defaults --------------------------------

const TAXONOMY: [group: string, sort: number, names: [string, CostType, Necessity][]][] = [
  ['Income', 10, [['Paycheck', 'fixed', 'income'], ['Reimbursement', 'variable', 'income'],
    ['Interest & Dividends', 'variable', 'income']]],
  ['Housing', 20, [['Rent', 'fixed', 'required'], ['Utilities', 'variable', 'required'],
    ['Internet & Phone', 'fixed', 'required'], ['Renters Insurance', 'fixed', 'required'],
    ['Home Goods', 'variable', 'discretionary']]],
  ['Transportation', 30, [['Gas', 'variable', 'required'], ['Parking & Tolls', 'variable', 'required'],
    ['Auto Insurance', 'fixed', 'required'], ['Car Payment', 'fixed', 'required'],
    ['Rideshare', 'variable', 'discretionary'], ['Flights', 'variable', 'discretionary']]],
  ['Food', 40, [['Groceries', 'variable', 'required'], ['Restaurants', 'variable', 'discretionary'],
    ['Coffee', 'variable', 'discretionary']]],
  ['Health', 50, [['Pharmacy', 'variable', 'required'], ['Insurance Premium', 'fixed', 'required'],
    ['Fitness', 'fixed', 'discretionary']]],
  ['Lifestyle', 60, [['Shopping', 'variable', 'discretionary'], ['Subscriptions', 'fixed', 'discretionary'],
    ['Entertainment', 'variable', 'discretionary'], ['Travel', 'variable', 'discretionary'],
    ['Gifts', 'variable', 'discretionary'], ['Cash Withdrawn', 'variable', 'discretionary'],
    ['Uncategorized', 'variable', 'discretionary']]],
  ['Financial', 70, [['Brokerage Contribution', 'variable', 'investment'],
    ['Retirement Contribution', 'fixed', 'investment'], ['Fees & Interest', 'variable', 'required'],
    ['Taxes', 'variable', 'required'], ['Student Loan', 'fixed', 'required'], ['Tuition', 'fixed', 'required']]],
  ['Transfers', 99, [['Credit Card Payment', 'variable', 'transfer'], ['Account Transfer', 'variable', 'transfer']]],
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export const categories: CategoryWithGroup[] = TAXONOMY.flatMap(([group, groupSort, names]) =>
  names.map(([name, cost, necessity], i) => ({
    id: `cat-${slug(name)}`,
    group_id: `grp-${slug(group)}`,
    name,
    parent_id: null,
    icon: null,
    color: null,
    default_cost_type: cost,
    default_necessity: necessity,
    is_archived: false,
    sort_order: i,
    group_name: group,
    group_sort_order: groupSort,
    parent_name: null,
  })));

const category = (name: string) => {
  const c = categories.find((x) => x.name === name);
  if (!c) throw new Error(`No fixture category ${name}`);
  return c;
};

// --- Six months of cashflow ------------------------------------------------

const month = (m: string, required: number, discretionary: number, variable: number, income = 1080000) => ({
  month: m,
  income_cents: income,
  required_cents: required,
  discretionary_cents: discretionary,
  invested_cents: 200000,
  fixed_cents: 307997,
  variable_cents: variable,
  spendable_cents: income - required,
});

export const cashflow: MonthlyCashflow[] = [
  month('2026-04-01', 356870, 60748, 109621),
  month('2026-05-01', 364723, 63338, 120064),
  month('2026-06-01', 376115, 62430, 130548),
  month('2026-07-01', 359728, 58895, 110626),
  month('2026-08-01', 370941, 59010, 121954),
  // The ledger ends on the 28th: the second paycheck has not landed yet.
  month('2026-09-01', 366248, 53035, 111286, 540000),
];

export const september = cashflow[cashflow.length - 1];

// --- September's spending by category ---------------------------------------

const row = (name: string, cents: number, count: number): CategoryBreakdownRow => {
  const c = category(name);
  return {
    category_id: c.id,
    category_name: name,
    category_group_name: c.group_name,
    necessity: c.default_necessity,
    cost_type: c.default_cost_type,
    total_cents: cents,
    txn_count: count,
  };
};

export const breakdown: CategoryBreakdownRow[] = [
  row('Rent', 285000, 1),
  row('Groceries', 47879, 4),
  row('Restaurants', 30276, 7),
  row('Shopping', 12208, 3),
  row('Gas', 10543, 2),
  row('Renters Insurance', 8500, 1),
  row('Utilities', 7326, 1),
  row('Internet & Phone', 7000, 1),
  row('Fitness', 4500, 1),
  row('Subscriptions', 2997, 3),
  row('Coffee', 2825, 5),
  row('Gifts', 451, 1),
];

export const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };

// --- The period picker, built by the app's own code -------------------------

export const periods = buildPeriods(
  ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'],
  { first: '2026-04-01', last: '2026-09-27' },
);

// --- Transactions -----------------------------------------------------------

let n = 0;

/**
 * A v_transactions row with demo defaults. Pass what the story is about; the
 * eff_* fields follow the raw ones unless the story overrides them, the way
 * the view resolves them (I3).
 */
export function txn(over: Partial<VTransaction> & { categoryName?: string } = {}): VTransaction {
  const { categoryName = 'Restaurants', ...rest } = over;
  const c = category(categoryName);
  const amount = rest.amount_cents ?? -4250;
  const date = rest.posted_date ?? '2026-09-26';
  const description = rest.raw_description ?? 'SQ *TACO HAUS';
  const base: VTransaction = {
    id: `txn-${++n}`,
    account_id: 'acct-explorer',
    amount_cents: amount,
    currency: 'USD',
    posted_date: date,
    authorized_date: null,
    status: 'posted',
    raw_description: description,
    description: null,
    merchant_id: null,
    amount_cents_override: null,
    posted_date_override: null,
    voided_at: null,
    void_reason: null,
    category_id: c.id,
    category_source: 'rule',
    category_locked: false,
    suggested_category_id: null,
    suggested_confidence: null,
    suggested_reason: null,
    cost_type_override: null,
    necessity_override: null,
    transfer_id: null,
    destination_account_id: null,
    exclude_from_totals: false,
    source: 'simplefin',
    import_batch_id: null,
    external_id: `demo-sf-${n}`,
    fingerprint: `demo-fp-${n}`,
    fingerprint_seq: 0,
    superseded_by_id: null,
    recurring_series_id: null,
    notes: null,
    created_at: new Date('2026-09-28T17:00:00Z'),
    updated_at: new Date('2026-09-28T17:00:00Z'),
    eff_amount_cents: rest.amount_cents_override ?? amount,
    eff_posted_date: rest.posted_date_override ?? date,
    eff_description: rest.description ?? description,
    is_amount_or_date_edited: rest.amount_cents_override != null || rest.posted_date_override != null,
    eff_cost_type: c.default_cost_type,
    eff_necessity: c.default_necessity,
    category_name: c.name,
    category_group_name: c.group_name,
    account_name: 'Chase United Explorer',
    account_type: 'credit',
    counts_as_spending: c.default_necessity === 'required' || c.default_necessity === 'discretionary',
    is_card_payment_credit: false,
  };
  return { ...base, ...rest };
}
