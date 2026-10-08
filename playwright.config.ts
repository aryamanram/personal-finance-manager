import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression and accessibility, against the demo ledger only.
 *
 *   npm run test:visual          # compare every page with its baseline
 *   npm run test:visual:update   # accept the current rendering as the baseline
 *   npm run test:a11y            # axe, WCAG 2.1 A and AA
 *
 * Baselines are committed to a public repo, so every page here is the
 * synthetic ledger on 127.0.0.1:3001 (npm run dev:demo). global-setup.ts
 * reseeds it and refuses to run unless that is what the server is showing.
 */
const DEMO = 'http://127.0.0.1:3001';

export default defineConfig({
  testDir: 'tests/visual',
  testMatch: '*.spec.ts',
  globalSetup: './tests/visual/global-setup.ts',
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Font rendering differs by OS, so baselines are kept per platform.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Hides Next's dev-mode badge, which is not part of the app.
      stylePath: './tests/visual/screenshot.css',
    },
  },
  use: {
    baseURL: DEMO,
    timezoneId: 'America/Chicago',
    locale: 'en-US',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'npm run dev:demo',
    url: DEMO,
    // A demo server you already have running is reused. Only dev:demo binds
    // :3001 — the real app is pinned to -p 3000 so it cannot fall back here.
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
