/**
 * The Flow's model: where a period's money came from and where it went.
 *
 * Pure — no database, no React — so the arithmetic is tested directly and the
 * chart only draws what this returns. It balances by construction (V1 in
 * docs/design/OVERHAUL.md): each bucket is the sum of its categories, the
 * junction is the sum of the sources and of the buckets, and whatever does not
 * balance becomes "From savings" or "Left over", never a gap.
 */

/** Structurally what getFlow returns (lib/queries.ts), without importing it. */
export interface FlowInput {
  incomeCents: number;
  /** Net money into investments; negative when more came out than went in. */
  investedCents: number;
  creditsCents: number;
  categories: {
    category_id: string | null;
    category_name: string;
    necessity: string;
    /** Gross money out, positive. */
    total_cents: number;
    credit_cents: number;
    txn_count: number;
  }[];
}

export type SourceKey = 'income' | 'investments' | 'credits' | 'savings';
export type BucketKey = 'required' | 'discretionary' | 'invested' | 'leftover';

export interface FlowSource { key: SourceKey; label: string; cents: number }
export interface FlowCategory {
  id: string | null;
  name: string;
  cents: number;
  creditCents: number;
  txnCount: number;
}
export interface FlowBucket { key: BucketKey; label: string; cents: number; categories: FlowCategory[] }
export interface FlowModel {
  /** Only sources that carried money, in drawing order. */
  sources: FlowSource[];
  /** The junction: every source in, every bucket out. */
  totalCents: number;
  /** Only buckets that carried money, in drawing order. */
  buckets: FlowBucket[];
}

const SPENDING: Record<string, 'required' | 'discretionary'> = { required: 'required', discretionary: 'discretionary' };

/** Builds the Flow for a period, or null when no money moved. */
export function buildFlow(d: FlowInput): FlowModel | null {
  const spending: Record<'required' | 'discretionary', FlowCategory[]> = { required: [], discretionary: [] };
  for (const c of d.categories) {
    if (c.total_cents <= 0) continue;
    const bucket = SPENDING[c.necessity];
    // counts_as_spending admits only these two; anything else would be money
    // the chart silently leaves out, which is exactly what V1 forbids.
    if (!bucket) {
      throw new Error(`Spending category ${c.category_name} has necessity "${c.necessity}"`);
    }
    spending[bucket].push({
      id: c.category_id,
      name: c.category_name,
      cents: c.total_cents,
      creditCents: c.credit_cents,
      txnCount: c.txn_count,
    });
  }
  for (const list of Object.values(spending)) list.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));

  const sum = (xs: FlowCategory[]) => xs.reduce((a, c) => a + c.cents, 0);
  const required = sum(spending.required);
  const discretionary = sum(spending.discretionary);
  const invested = Math.max(0, d.investedCents);
  const fromInvestments = Math.max(0, -d.investedCents);
  const income = Math.max(0, d.incomeCents);
  const credits = Math.max(0, d.creditsCents);

  const moneyIn = income + fromInvestments + credits;
  const moneyOut = required + discretionary + invested;
  const leftover = Math.max(0, moneyIn - moneyOut);
  const savings = Math.max(0, moneyOut - moneyIn);
  const totalCents = moneyIn + savings;
  if (totalCents <= 0) return null;

  const sources = ([
    { key: 'income', label: 'Income', cents: income },
    { key: 'investments', label: 'From investments', cents: fromInvestments },
    { key: 'credits', label: 'Credits', cents: credits },
    { key: 'savings', label: 'From savings', cents: savings },
  ] satisfies FlowSource[]).filter((s) => s.cents > 0);

  const buckets = ([
    { key: 'required', label: 'Required', cents: required, categories: spending.required },
    { key: 'discretionary', label: 'Discretionary', cents: discretionary, categories: spending.discretionary },
    { key: 'invested', label: 'Invested', cents: invested, categories: [] },
    { key: 'leftover', label: 'Left over', cents: leftover, categories: [] },
  ] satisfies FlowBucket[]).filter((b) => b.cents > 0);

  return { sources, totalCents, buckets };
}
