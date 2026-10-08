import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FlowDrilldown } from '@/components/FlowDrilldown';
import { breakdown, SEPTEMBER } from './fixtures';

/** Below the Sankey: pick required or discretionary, see what carries it. */
const meta = {
  title: 'Flow/FlowDrilldown',
  component: FlowDrilldown,
  args: { breakdown, ...SEPTEMBER },
} satisfies Meta<typeof FlowDrilldown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const September: Story = {};
