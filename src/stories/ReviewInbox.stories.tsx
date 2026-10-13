import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ReviewInbox } from '@/components/ReviewInbox';
import { categories, colors, groupSlots, txn } from './fixtures';

/**
 * Review: the guesses no human has confirmed, worked from the keyboard. Try
 * j and k to move, a to accept, c to choose a category. (Accepting calls the
 * app's API, which Storybook does not have.)
 */
const meta = {
  title: 'Review/ReviewInbox',
  component: ReviewInbox,
  args: {
    categories,
    groupSlots,
    colors,
    rows: [
      txn({ raw_description: 'SQ *TACO HAUS', categoryName: 'Takeout', suggested_reason: 'your rule: Takeout' }),
      txn({ raw_description: 'TRADER JOES #447', categoryName: 'Groceries', amount_cents: -10055, posted_date: '2026-09-24' }),
      txn({ raw_description: 'CHEVRON 00982341', categoryName: 'Gas', amount_cents: -4185, posted_date: '2026-09-20' }),
      txn({ raw_description: 'MYSTERY MERCHANT', categoryName: 'Uncategorized', category_id: null, category_name: null, category_source: 'unset', amount_cents: -1500, posted_date: '2026-09-19' }),
    ],
  },
  parameters: { nextjs: { navigation: { pathname: '/review' } } },
} satisfies Meta<typeof ReviewInbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {};
export const NothingToReview: Story = { args: { rows: [] } };
