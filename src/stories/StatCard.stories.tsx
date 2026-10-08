import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { StatCard } from '@/components/StatCard';
import { cashflow, september } from './fixtures';

const august = cashflow[cashflow.length - 2];

/** The four numbers across the top of Cashflow, each against last month. */
const meta = {
  title: 'Cashflow/StatCard',
  component: StatCard,
  args: { label: 'Required', cents: september.required_cents, previousCents: august.required_cents, tone: 'out' },
} satisfies Meta<typeof StatCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Required: Story = {};
export const Income: Story = {
  args: { label: 'Income', cents: september.income_cents, previousCents: august.income_cents, tone: 'in' },
};
export const Spendable: Story = {
  args: {
    label: 'Spendable', cents: september.spendable_cents, previousCents: august.spendable_cents,
    tone: 'neutral', hint: 'income − required', emphasis: true,
  },
};
export const NoPriorMonth: Story = { args: { previousCents: null } };

/** As the Cashflow page lays them out. */
export const Row: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
      <StatCard label="Income" cents={september.income_cents} previousCents={august.income_cents} tone="in" />
      <StatCard label="Required" cents={september.required_cents} previousCents={august.required_cents} tone="out" />
      <StatCard label="Discretionary" cents={september.discretionary_cents} previousCents={august.discretionary_cents} tone="out" />
      <StatCard label="Spendable" cents={september.spendable_cents} previousCents={august.spendable_cents}
        tone="neutral" hint="income − required" emphasis />
    </div>
  ),
};
