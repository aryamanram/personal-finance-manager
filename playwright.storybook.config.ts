import { defineConfig, devices } from '@playwright/test';

/**
 * npm run test:storybook — every story renders, and none of them sends a
 * request off this machine. Storybook only ever shows fixture data, but a
 * request to a third party still says who is looking and when; the app was
 * built so that nothing does, and Storybook should not undo that.
 */
export default defineConfig({
  testDir: 'tests/storybook',
  testMatch: '*.spec.ts',
  forbidOnly: true,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:6006' },
  webServer: {
    command: 'npm run storybook -- --ci',
    url: 'http://127.0.0.1:6006/index.json',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
