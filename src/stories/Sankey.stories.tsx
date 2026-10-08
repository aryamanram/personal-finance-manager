import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Sankey, type SankeyInput } from '@/components/Sankey';
import type { CategoryBreakdownRow } from '@/lib/queries';
import type { MonthlyCashflow } from '@/lib/types';
import { augustBreakdown, breakdown, cashflow, september } from './fixtures';

const august = cashflow[cashflow.length - 2];

/** One month's totals with that same month's categories, as /flow builds it. */
function month(totals: MonthlyCashflow, rows: CategoryBreakdownRow[]): SankeyInput {
  return {
    incomeCents: totals.income_cents ?? 0,
    requiredCents: totals.required_cents ?? 0,
    discretionaryCents: totals.discretionary_cents ?? 0,
    investedCents: totals.invested_cents ?? 0,
    categories: rows.map((b) => ({ name: b.category_name, necessity: b.necessity, cents: b.total_cents })),
  };
}

/** Where the month's money went: income, through buckets, into categories. */
const meta = {
  title: 'Flow/Sankey',
  component: Sankey,
  args: { data: month(august, augustBreakdown) },
} satisfies Meta<typeof Sankey>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullMonth: Story = {};
/** Spending ran ahead of income: the gap is drawn from savings. */
export const PartialMonth: Story = { args: { data: month(september, breakdown) } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
