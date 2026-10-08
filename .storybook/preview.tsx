import type { Preview } from '@storybook/nextjs-vite';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/jetbrains-mono';
import '../src/app/globals.css';

// The app gets its fonts from next/font, downloaded once at build and served
// by the app. Under Storybook's Vite builder next/font/google loads them from
// fonts.gstatic.com at view time instead — telling Google who is looking. So
// Storybook bundles the same two families from npm and sets the variables
// globals.css reads, on <html>, where the app's layout puts them.
const root = document.documentElement.style;
root.setProperty('--font-inter-tight', "'Inter Tight Variable'");
root.setProperty('--font-jetbrains-mono', "'JetBrains Mono Variable'");
document.body.classList.add('bg-ink-900');

const preview: Preview = {
  parameters: {
    layout: 'padded',
    // The app has one ground — ink. A white canvas would misrepresent every
    // colour on it, so the backgrounds switcher is off.
    backgrounds: { disable: true },
    nextjs: { appDirectory: true },
  },
};

export default preview;
