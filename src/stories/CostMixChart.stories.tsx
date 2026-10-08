import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CostMixChart } from '@/components/CostMixChart';
import { cashflow } from './fixtures';

/** Fixed against variable spending, month by month. */
const meta = {
  title: 'Cashflow/CostMixChart',
  component: CostMixChart,
  args: { data: cashflow },
} satisfies Meta<typeof CostMixChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SixMonths: Story = {};
export const OneMonth: Story = { args: { data: cashflow.slice(-1) } };
export const Empty: Story = { args: { data: [] } };
