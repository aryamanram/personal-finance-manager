import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Nav } from '@/components/Nav';

const NAV = [
  { href: '/', label: 'Flow' },
  { href: '/review', label: 'Review', count: 12 },
  { href: '/transactions', label: 'Register' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/setup', label: 'Setup' },
];

/** The header navigation; the current page is lit. */
const meta = {
  title: 'Navigation/Nav',
  component: Nav,
  args: { items: NAV },
} satisfies Meta<typeof Nav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTheFlow: Story = { parameters: { nextjs: { navigation: { pathname: '/' } } } };
/** A category page is a drill-down of the register, so Register stays lit. */
export const OnACategory: Story = {
  parameters: { nextjs: { navigation: { pathname: '/categories/cat-groceries' } } },
};
