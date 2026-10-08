import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Figure } from '@/components/Figure';

/**
 * Every amount in the ledger. Tabular figures, so a column of them aligns on
 * the decimal; tone from the sign unless the caller says otherwise; and the
 * amber dotted underline when a human corrected the bank's number.
 */
const meta = {
  title: 'Figures/Figure',
  component: Figure,
  args: { cents: -4250 },
} satisfies Meta<typeof Figure>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Outflow: Story = {};
export const Inflow: Story = { args: { cents: 540000 } };
export const Invested: Story = { args: { cents: -200000, tone: 'invest' } };
export const Neutral: Story = { args: { cents: -285000, tone: 'neutral' } };
export const Signed: Story = { args: { cents: 540000, signed: true } };
export const WholeDollars: Story = { args: { cents: 1080000, showCents: false } };
/** Hover it: the original, synced amount. Amber means a human changed this. */
export const Corrected: Story = { args: { cents: -2500, original: -9583 } };
export const Missing: Story = { args: { cents: null } };

/** The reason for tabular figures: a column reads down its decimal points. */
export const Column: Story = {
  render: () => (
    <div className="flex w-40 flex-col items-end gap-1">
      {[-285000, -47879, -2825, -451, 540000, -200000].map((c) => (
        <Figure key={c} cents={c} />
      ))}
    </div>
  ),
};
