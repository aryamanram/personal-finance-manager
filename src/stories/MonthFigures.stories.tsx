import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MonthFigures } from '@/components/MonthFigures';
import { buildFlow } from '@/lib/flow';
import { septemberFlow, SEPTEMBER } from './fixtures';

const september = buildFlow(septemberFlow);
// August, with its second paycheck: what September's change is measured from.
const august = buildFlow({ ...septemberFlow, incomeCents: 1080000, creditsCents: 229 });

/**
 * The period in five numbers, the same ones the Flow's nodes carry. Dollars
 * large, cents a step down; the change is in ink with an arrow, never red.
 */
const meta = {
  title: 'Flow/MonthFigures',
  component: MonthFigures,
  args: { model: september, previous: august, previousLabel: 'August', period: SEPTEMBER },
} satisfies Meta<typeof MonthFigures>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Spending ran past income: the fifth figure is From savings. */
export const FromSavings: Story = {};
/** A whole month: what was not spent or invested is Left over. */
export const LeftOver: Story = { args: { model: august, previous: null, previousLabel: undefined } };
