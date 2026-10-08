import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { TransactionRow } from '@/components/TransactionRow';
import { categories, txn } from './fixtures';

/**
 * One line of the register. Its states are the ledger's vocabulary: a
 * machine guess waiting for a nod, a category a human locked (amber diamond),
 * an amount a human corrected (amber dotted underline), pending, voided.
 */
const meta = {
  title: 'Register/TransactionRow',
  component: TransactionRow,
  // Rows are <tr>s; the register's table sets the column widths.
  decorators: [
    (Story) => (
      <table className="w-full min-w-[680px] table-fixed">
        <thead>
          <tr className="rule-b">
            <th className="w-8 pl-1" />
            <th className="eyebrow w-24 py-2 text-left">Date</th>
            <th className="eyebrow py-2 text-left">Description</th>
            <th className="eyebrow w-56 py-2 text-left">Category</th>
            <th className="eyebrow w-32 py-2 pr-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <Story />
        </tbody>
      </table>
    ),
  ],
  args: {
    txn: txn(),
    categories,
    selected: false,
    onSelect: fn(),
    onPatch: fn(),
    onConfirm: fn(),
  },
} satisfies Meta<typeof TransactionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A rule's guess: the Accept chip confirms and locks it. */
export const Guessed: Story = {};

export const Paycheck: Story = {
  args: {
    txn: txn({
      raw_description: 'ACME CORP PAYROLL DIRECT DEP', amount_cents: 540000, posted_date: '2026-09-15',
      categoryName: 'Paycheck', account_name: 'Chase Total Checking', category_source: 'income_source',
    }),
  },
};

/** Renamed and re-filed by hand: amber diamond on the locked category. */
export const LockedByHand: Story = {
  args: {
    txn: txn({
      raw_description: 'STARBUCKS #12345', description: 'Coffee for the team', amount_cents: -451,
      posted_date: '2026-09-22', categoryName: 'Gifts', category_source: 'manual', category_locked: true,
      notes: 'Reimbursable?', account_name: 'Apple Card', source: 'csv',
    }),
  },
};

/** The bank said $95.83; a human said $25.00. The dotted underline keeps both. */
export const AmountCorrected: Story = {
  args: {
    txn: txn({
      raw_description: 'AMAZON.COM*RT4X9', amount_cents: -9583, amount_cents_override: -2500,
      posted_date: '2026-09-23', categoryName: 'Shopping', account_name: 'Apple Card', source: 'csv',
    }),
  },
};

export const Pending: Story = {
  args: { txn: txn({ raw_description: 'THE LOCAL BISTRO', amount_cents: -6400, posted_date: '2026-09-27', status: 'pending' }) },
};

export const Voided: Story = {
  args: {
    txn: txn({
      raw_description: 'WHOLE FOODS MKT 10234', amount_cents: -11200, posted_date: '2026-08-11',
      categoryName: 'Groceries', voided_at: new Date('2026-09-28T17:00:00Z'),
      void_reason: 'Duplicate — bank posted this twice',
    }),
  },
};

export const Selected: Story = { args: { selected: true } };

/** The row above has the same date, so this one does not repeat it. */
export const SameDayAsAbove: Story = { args: { repeatsDate: true } };
