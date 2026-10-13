import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FlowView } from '@/components/FlowView';
import { buildFlow } from '@/lib/flow';
import { septemberFlow, SEPTEMBER } from './fixtures';

/**
 * The Flow section of the first page: the chart, the group legend, the
 * Chart / Table switch, and "Show every category". The table carries the
 * same numbers, with every name a link to exactly its rows.
 */
const meta = {
  title: 'Flow/FlowView',
  component: FlowView,
  args: { model: buildFlow(septemberFlow), period: SEPTEMBER, label: 'September 2026' },
  parameters: { nextjs: { navigation: { pathname: '/' } } },
} satisfies Meta<typeof FlowView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const September: Story = {};
export const NothingMoved: Story = { args: { model: null } };
/** On a phone the table comes first; the chart is a tap away. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
