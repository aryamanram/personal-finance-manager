import { useEffect } from 'react';
import type { Decorator } from '@storybook/nextjs-vite';

/**
 * Shows a story in one theme, the way the switch in the header pins it, and
 * lets go afterwards — Storybook reuses its frame between stories.
 */
export const inTheme = (theme: 'light' | 'dark'): Decorator => function InTheme(Story) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    return () => { delete root.dataset.theme; };
  }, []);
  return <Story />;
};
