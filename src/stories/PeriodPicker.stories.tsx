import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PeriodPicker } from '@/components/PeriodPicker';
import { periods } from './fixtures';

/** All time › year › month › pay period, built by lib/periods.ts. */
const meta = {
  title: 'Navigation/PeriodPicker',
  component: PeriodPicker,
  parameters: { nextjs: { navigation: { pathname: '/' } } },
  args: { options: periods, active: '2026-09' },
} satisfies Meta<typeof PeriodPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Month: Story = {};
export const AllTime: Story = { args: { active: 'all' } };
export const PayPeriod: Story = { args: { active: '2026-09-H1' } };
