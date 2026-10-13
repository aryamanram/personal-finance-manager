import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ThemeSwitch } from '@/components/ThemeSwitch';

/** System, light or dark. The choice is a cookie the layout reads, so it paints right first time. */
const meta = {
  title: 'Navigation/ThemeSwitch',
  component: ThemeSwitch,
  args: { initial: 'system' },
} satisfies Meta<typeof ThemeSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const System: Story = {};
export const PinnedDark: Story = { args: { initial: 'dark' } };
