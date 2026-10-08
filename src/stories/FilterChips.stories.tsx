import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FilterChips } from '@/components/FilterChips';

/** The register's backlog chips. */
const meta = {
  title: 'Register/FilterChips',
  component: FilterChips,
  parameters: { nextjs: { navigation: { pathname: '/transactions' } } },
  args: {
    needsReview: 35,
    uncategorized: 0,
    active: { review: false, uncategorized: false, voided: false },
    hasFilters: false,
  },
} satisfies Meta<typeof FilterChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ReviewingBacklog: Story = {
  args: { active: { review: true, uncategorized: false, voided: false }, hasFilters: true },
};
export const WithUncategorized: Story = { args: { uncategorized: 3 } };
export const BacklogCleared: Story = { args: { needsReview: 0 } };
