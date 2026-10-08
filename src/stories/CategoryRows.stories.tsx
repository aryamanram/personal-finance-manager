import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CategoryRows } from '@/components/CategoryRows';
import { breakdown, SEPTEMBER } from './fixtures';

/** "Where it went" on Cashflow: each row opens the register, filtered. */
const meta = {
  title: 'Cashflow/CategoryRows',
  component: CategoryRows,
  args: { rows: breakdown, ...SEPTEMBER },
} satisfies Meta<typeof CategoryRows>;

export default meta;
type Story = StoryObj<typeof meta>;

export const September: Story = {};
export const LimitedToFive: Story = { args: { limit: 5 } };
