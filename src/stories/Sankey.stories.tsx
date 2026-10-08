import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Sankey } from '@/components/Sankey';
import { augustFlow, septemberFlow } from './fixtures';

/**
 * Where the month's money went: sources, through buckets, into categories.
 * Every node balances to the cent (lib/flow.ts, tests/flow.test.ts).
 */
const meta = {
  title: 'Flow/Sankey',
  component: Sankey,
  args: { data: augustFlow },
} satisfies Meta<typeof Sankey>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Income and the month's Daily Cash credit in; the rest left over. */
export const FullMonth: Story = {};
/** Spending ran ahead of income: the gap is drawn from savings. */
export const PartialMonth: Story = { args: { data: septemberFlow } };
/** Money taken out of investments is a source, not negative investing. */
export const FromInvestments: Story = {
  args: { data: { ...augustFlow, incomeCents: 0, investedCents: -250000, creditsCents: 0 } },
};
export const NothingMoved: Story = {
  args: { data: { incomeCents: 0, investedCents: 0, creditsCents: 0, categories: [] } },
};
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
