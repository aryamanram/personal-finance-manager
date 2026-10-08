import type { StorybookConfig } from '@storybook/nextjs-vite';

/**
 * Storybook for the presentational components — the parts of the ledger that
 * render from props alone, fed from src/stories/fixtures.ts (synthetic data,
 * the same the demo ledger seeds). Nothing here reads a database.
 *
 *   npm run storybook         # http://127.0.0.1:6006
 *   npm run build-storybook   # static build in storybook-static/
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/nextjs-vite', options: {} },
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  // On by default, it reports usage to Storybook's servers. This project
  // sends nothing anywhere it does not have to.
  core: { disableTelemetry: true },
};

export default config;
