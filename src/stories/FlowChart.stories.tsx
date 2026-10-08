import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { FlowChart } from '@/components/FlowChart';
import { buildFlow, buildCategoryFlow, flowGraph, categoryGraph, type FlowInput } from '@/lib/flow';
import { septemberFlow, restaurantsFlow, SEPTEMBER } from './fixtures';
import { inTheme } from './Theme';

const graphOf = (input: FlowInput, expanded: string[] = []) => {
  const model = buildFlow(input);
  return model ? flowGraph(model, SEPTEMBER, new Set(expanded)) : { nodes: [], links: [] };
};

/**
 * A Flow, drawn: sources and buckets in ink, categories in their group's
 * colour, every node labelled to the cent. Hover a node for its path; focus
 * one with Tab and press Enter to do what a click does. Every node balances
 * (lib/flow.ts, tests/flow.test.ts).
 */
const meta = {
  title: 'Flow/FlowChart',
  component: FlowChart,
  args: {
    graph: graphOf(septemberFlow),
    label: "Where September's money went",
    onFocusCategory: fn(),
    onExpand: fn(),
  },
} satisfies Meta<typeof FlowChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The demo's September: a short month drawn partly from savings. */
export const September: Story = {};
/** The column gaps the Flow page uses, giving the room to the colour. */
export const AsOnThePage: Story = { args: { gaps: [0.55, 0.8, 1.35, 1.15] } };
/** "+N more" opened: every category, and every subcategory. */
export const EveryCategory: Story = {
  args: {
    graph: graphOf(septemberFlow, ['bucket:required', 'bucket:discretionary']),
    gaps: [0.55, 0.8, 1.35, 1.15],
  },
};
/** Money taken out of investments is a source, not negative investing. */
export const FromInvestments: Story = {
  args: { graph: graphOf({ ...septemberFlow, incomeCents: 0, investedCents: -500000, creditsCents: 0 }) },
};
export const NothingMoved: Story = {
  args: { graph: graphOf({ incomeCents: 0, investedCents: 0, creditsCents: 0, categories: [] }) },
};
/** Restaurants on its own: the bucket, the category, its subcategories, the merchants. */
export const InsideACategory: Story = {
  args: {
    graph: categoryGraph(
      buildCategoryFlow({ id: 'cat-restaurants', name: 'Restaurants', group: 'Food', slot: 3 }, restaurantsFlow)!,
      SEPTEMBER,
    ),
    label: 'Inside Restaurants',
  },
};
/** The dark theme is its own set of steps, not an inversion. */
export const Dark: Story = { args: { gaps: [0.55, 0.8, 1.35, 1.15] }, decorators: [inTheme('dark')] };
