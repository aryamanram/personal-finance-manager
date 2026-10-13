import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CategoryInside } from '@/components/CategoryInside';
import { buildFlow, buildCategoryFlow, insideOptions } from '@/lib/flow';
import { septemberFlow, restaurantsFlow, SEPTEMBER, colors } from './fixtures';

const options = insideOptions(buildFlow(septemberFlow));
const restaurants = buildCategoryFlow({ id: 'cat-restaurants', name: 'Restaurants', group: 'Food', slot: 3 }, restaurantsFlow, colors);

/**
 * The second level of Flow: one category, from the bucket that paid for it to
 * the merchants. The picker lists every category and subcategory that spent
 * this period, by group, with its colour and amount.
 */
const meta = {
  title: 'Flow/CategoryInside',
  component: CategoryInside,
  args: { detail: restaurants, options, period: SEPTEMBER },
  parameters: { nextjs: { navigation: { pathname: '/' } } },
} satisfies Meta<typeof CategoryInside>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Restaurants: Story = {};
/** A subcategory: straight to its merchants, with a way back to the parent. */
export const Takeout: Story = {
  args: {
    detail: buildCategoryFlow(
      { id: 'cat-takeout', name: 'Takeout', group: 'Food', slot: 3 },
      restaurantsFlow.filter((r) => r.category_name === 'Takeout'),
      colors,
    ),
  },
};
export const NothingSpent: Story = { args: { detail: null } };
