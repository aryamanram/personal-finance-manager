import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Sankey } from '@/components/Sankey';
import { breakdown, cashflow, september } from './fixtures';

const categories = breakdown.map((b) => ({ name: b.category_name, necessity: b.necessity, cents: b.total_cents }));
const august = cashflow[cashflow.length - 2];

/** Where the month's money went: income, through buckets, into categories. */
const meta = {
  title: 'Flow/Sankey',
  component: Sankey,
  args: {
    data: {
      incomeCents: august.income_cents ?? 0,
      requiredCents: august.required_cents ?? 0,
      discretionaryCents: august.discretionary_cents ?? 0,
      investedCents: august.invested_cents ?? 0,
      categories,
    },
  },
} satisfies Meta<typeof Sankey>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullMonth: Story = {};
/** Spending ran ahead of income: the gap is drawn from savings. */
export const PartialMonth: Story = {
  args: {
    data: {
      incomeCents: september.income_cents ?? 0,
      requiredCents: september.required_cents ?? 0,
      discretionaryCents: september.discretionary_cents ?? 0,
      investedCents: september.invested_cents ?? 0,
      categories,
    },
  },
};
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
