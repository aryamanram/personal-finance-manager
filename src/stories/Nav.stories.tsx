import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Nav } from '@/components/Nav';

const NAV = [
  { href: '/', label: 'Cashflow' },
  { href: '/flow', label: 'Flow' },
  { href: '/transactions', label: 'Register' },
  { href: '/accounts', label: 'Accounts' },
] as const;

/** The header navigation; the current page is lit. */
const meta = {
  title: 'Navigation/Nav',
  component: Nav,
  args: { items: NAV },
} satisfies Meta<typeof Nav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnCashflow: Story = { parameters: { nextjs: { navigation: { pathname: '/' } } } };
/** A category page is a drill-down of the register, so Register stays lit. */
export const OnACategory: Story = {
  parameters: { nextjs: { navigation: { pathname: '/categories/cat-groceries' } } },
};
