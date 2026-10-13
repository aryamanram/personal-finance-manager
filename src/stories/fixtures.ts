/**
 * Story data. Synthetic, and the same synthetic data the demo ledger seeds
 * (scripts/seed-demo.ts, SEED_TODAY 2026-09-28), so a story and the page it
 * comes from on :3001 show the same numbers. Never put a real merchant,
 * amount or account here — this file is public.
 */
import type { FlowInput, FlowRow, CategoryFlowInputRow } from '@/lib/flow';
import { categoryColors } from '@/lib/palette';
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

const top: CategoryWithGroup[] = TAXONOMY.flatMap(([group, groupSort, names]) =>
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

/** The demo's three split parents (scripts/seed-demo.ts). */
const SUBCATEGORIES: [parent: string, children: string[]][] = [
  ['Restaurants', ['Dining out', 'Takeout']],
  ['Subscriptions', ['Streaming', 'Apps & cloud']],
  ['Shopping', ['Clothing', 'Household']],
];

/** The taxonomy with these parents split into these subcategories. */
const withSubcategories = (splits: [parent: string, children: string[]][]): CategoryWithGroup[] => [
  ...top,
  ...splits.flatMap(([parentName, children]) => {
    const parent = top.find((c) => c.name === parentName)!;
    return children.map((name, i) => ({
      ...parent, id: `cat-${slug(name)}`, name, parent_id: parent.id, parent_name: parent.name, sort_order: i + 1,
    }));
  }),
];

export const categories: CategoryWithGroup[] = withSubcategories(SUBCATEGORIES);

/** The palette slot of each group that holds spending, as getGroupSlots returns it. */
export const groupSlots: Record<string, number> = {
  Housing: 1, Transportation: 2, Food: 3, Health: 4, Lifestyle: 5, Financial: 6,
};

const category = (name: string, from = categories) => {
  const c = from.find((x) => x.name === name);
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

// --- The Flow ---------------------------------------------------------------
//
// What the app's own getFlow returns on the demo for September (to the 27th,
// where its data ends): gross money out per category, a subcategory carrying
// its parent. Credits — the month's Daily Cash and an Amazon return — are
// counted once, as the Flow's Credits source, which is what makes it balance.

const flowRow = (
  name: string, necessity: string, cents: number, count: number, credit = 0, from = categories,
): FlowRow => {
  const c = category(name, from);
  return {
    category_id: c.id,
    category_name: name,
    category_group_name: c.group_name,
    parent_id: c.parent_id,
    parent_name: c.parent_name,
    necessity,
    total_cents: cents,
    credit_cents: credit,
    txn_count: count,
  };
};

/** Each category's own shade, as the pages compute it (lib/palette.ts). */
export const colors = categoryColors(categories, groupSlots);

export const septemberFlow: FlowInput = {
  incomeCents: 540000,
  investedCents: 200000,
  creditsCents: 4566,
  groupSlots,
  colors,
  categories: [
    flowRow('Rent', 'required', 285000, 1),
    flowRow('Groceries', 'required', 44518, 4),
    flowRow('Takeout', 'discretionary', 19537, 5),
    flowRow('Gas', 'required', 10829, 2),
    flowRow('Household', 'discretionary', 8918, 1),
    flowRow('Renters Insurance', 'required', 8500, 1),
    flowRow('Utilities', 'required', 7250, 1),
    flowRow('Internet & Phone', 'required', 7000, 1),
    flowRow('Clothing', 'discretionary', 6913, 1),
    flowRow('Dining out', 'discretionary', 6578, 2),
    flowRow('Rideshare', 'discretionary', 5469, 2),
    flowRow('Entertainment', 'discretionary', 5204, 1),
    flowRow('Fitness', 'discretionary', 4500, 1),
    flowRow('Streaming', 'discretionary', 2698, 2),
    flowRow('Coffee', 'discretionary', 2538, 5),
    flowRow('Shopping', 'discretionary', 2500, 2, 4275),
    flowRow('Pharmacy', 'required', 2419, 1),
    flowRow('Gifts', 'discretionary', 684, 1),
    flowRow('Apps & cloud', 'discretionary', 299, 1),
  ],
};

export const SEPTEMBER = { from: '2026-09-01', to: '2026-09-27' };

// --- A long period ----------------------------------------------------------
//
// Two years of a ledger whose categories have mostly been split: what an
// "All time" Flow looks like once there is history, and what the trunk has
// to stay larger than (docs/design/OVERHAUL.md, ask 12). Invented, like
// everything here; the demo itself holds six months.

const LONG_SPLITS: [parent: string, children: string[]][] = [
  ['Restaurants', ['Dining out', 'Takeout']],
  ['Shopping', ['Clothing', 'Household', 'Books', 'Garden', 'Pets', 'Toys', 'Sports gear']],
  ['Subscriptions', ['Streaming', 'Apps & cloud', 'Music', 'News', 'Podcasts']],
  ['Entertainment', ['Movies', 'Museums', 'Theatre', 'Bowling', 'Arcade']],
  ['Travel', ['Hotels', 'Tours']],
];
export const longCategories = withSubcategories(LONG_SPLITS);
export const longColors = categoryColors(longCategories, groupSlots);
export const LONG_PERIOD = { from: '2024-10-01', to: '2026-09-27' };

const long = (name: string, necessity: string, cents: number, count: number) =>
  flowRow(name, necessity, cents, count, 0, longCategories);

export const longPeriodFlow: FlowInput = {
  incomeCents: 9_600_000,
  investedCents: 1_200_000,
  creditsCents: 31_500,
  groupSlots,
  colors: longColors,
  categories: [
    long('Rent', 'required', 6_840_000, 24),
    long('Groceries', 'required', 1_050_000, 190),
    long('Gas', 'required', 260_000, 60),
    long('Renters Insurance', 'required', 204_000, 24),
    long('Utilities', 'required', 175_000, 24),
    long('Internet & Phone', 'required', 168_000, 24),
    long('Pharmacy', 'required', 58_000, 14),
    long('Parking & Tolls', 'required', 21_000, 30),
    long('Fees & Interest', 'required', 4_500, 3),
    long('Takeout', 'discretionary', 470_000, 120),
    long('Dining out', 'discretionary', 160_000, 40),
    long('Clothing', 'discretionary', 330_000, 30),
    long('Household', 'discretionary', 210_000, 28),
    long('Pets', 'discretionary', 120_000, 20),
    long('Books', 'discretionary', 90_000, 25),
    long('Sports gear', 'discretionary', 60_000, 6),
    long('Garden', 'discretionary', 40_000, 9),
    long('Toys', 'discretionary', 25_000, 5),
    long('Streaming', 'discretionary', 64_000, 48),
    long('Music', 'discretionary', 26_000, 24),
    long('News', 'discretionary', 12_000, 12),
    long('Apps & cloud', 'discretionary', 7_200, 24),
    long('Podcasts', 'discretionary', 6_000, 12),
    long('Theatre', 'discretionary', 45_000, 4),
    long('Movies', 'discretionary', 30_000, 14),
    long('Museums', 'discretionary', 18_000, 6),
    long('Bowling', 'discretionary', 9_000, 3),
    long('Arcade', 'discretionary', 4_000, 2),
    long('Hotels', 'discretionary', 140_000, 5),
    long('Tours', 'discretionary', 30_000, 2),
    long('Flights', 'discretionary', 210_000, 4),
    long('Rideshare', 'discretionary', 130_000, 70),
    long('Fitness', 'discretionary', 108_000, 24),
    long('Coffee', 'discretionary', 61_000, 150),
    long('Cash Withdrawn', 'discretionary', 50_000, 8),
    long('Gifts', 'discretionary', 40_000, 9),
  ],
};

/** getCategoryFlow for Restaurants in September, as the page gets it. */
export const restaurantsFlow: CategoryFlowInputRow[] = [
  { category_id: 'cat-takeout', category_name: 'Takeout', necessity: 'discretionary', merchant_id: 'm-chipotle', merchant_name: 'Chipotle', total_cents: 11161, credit_cents: 0, txn_count: 3 },
  { category_id: 'cat-takeout', category_name: 'Takeout', necessity: 'discretionary', merchant_id: 'm-taco-haus', merchant_name: 'Taco Haus', total_cents: 8376, credit_cents: 0, txn_count: 2 },
  { category_id: 'cat-dining-out', category_name: 'Dining out', necessity: 'discretionary', merchant_id: 'm-noodle-bar', merchant_name: 'Noodle Bar', total_cents: 6578, credit_cents: 0, txn_count: 2 },
];

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
