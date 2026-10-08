import { expect, test } from '@playwright/test';
import { PAGES, openDemoPage } from './pages';

for (const p of PAGES) {
  test(`${p.name} matches its baseline`, async ({ page }) => {
    await openDemoPage(page, p);
    await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: true });
  });
}
