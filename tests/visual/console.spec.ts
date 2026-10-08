import { expect, test } from '@playwright/test';
import { PAGES, openDemoPage } from './pages';

/**
 * Every page loads without a console error — which is where React reports a
 * hydration mismatch. One was found on the register by eye once; this keeps
 * the next one from going unseen.
 */
for (const p of PAGES) {
  test(`${p.name} loads without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await openDemoPage(page, p);
    expect(errors).toEqual([]);
  });
}
