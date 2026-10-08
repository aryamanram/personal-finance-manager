import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { CategoryPalette } from '@/components/CategoryPalette';
import { categories } from './fixtures';

/** Picking a category: group › category › subcategory, one short list at a time. */
const meta = {
  title: 'Register/CategoryPalette',
  component: CategoryPalette,
  args: { categories, onPick: fn(), onClose: fn() },
} satisfies Meta<typeof CategoryPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Assigning: Story = { args: { currentId: 'cat-restaurants' } };
export const Filtering: Story = {
  args: { currentId: null, clearLabel: { name: 'Any category', hint: 'drop the filter' } },
};
