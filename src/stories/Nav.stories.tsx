import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { MobileNav, NavLinks, Sidebar } from '@/components/Nav';

const NAV = [
  { href: '/', label: 'Flow' },
  { href: '/review', label: 'Review', count: 12 },
  { href: '/transactions', label: 'Register' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/setup', label: 'Setup' },
];

/**
 * The sections, down the left edge: full rows from 1024px, a rail of icons
 * with their names beneath on a tablet, a menu button on a phone. The
 * current page is lit.
 */
const meta = {
  title: 'Navigation/Sidebar',
  component: Sidebar,
  args: { items: NAV, theme: 'system' },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnTheFlow: Story = { parameters: { nextjs: { navigation: { pathname: '/' } } } };
/** A category page is a drill-down of the register, so Register stays lit. */
export const OnACategory: Story = {
  parameters: { nextjs: { navigation: { pathname: '/categories/cat-groceries' } } },
};
/** The rail a tablet gets: each icon with its name beneath, the count on its corner. */
export const OnATablet: Story = {
  parameters: { nextjs: { navigation: { pathname: '/review' } } },
  globals: { viewport: { value: 'ipad' } },
};
/** On a phone: the wordmark and a menu button; the button opens the same list. */
export const OnAPhone: Story = {
  render: (args) => <MobileNav items={args.items} theme={args.theme} />,
  parameters: { nextjs: { navigation: { pathname: '/' } } },
  globals: { viewport: { value: 'mobile1' } },
};
/** The list the phone's menu opens, on its own. */
export const TheMenu: Story = {
  render: (args) => (
    <div className="max-w-sm p-3">
      <NavLinks items={args.items} period={null} variant="menu" />
    </div>
  ),
  parameters: { nextjs: { navigation: { pathname: '/transactions' } } },
};
