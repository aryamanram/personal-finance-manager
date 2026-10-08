import { expect, test, type Page } from '@playwright/test';
import { SEED_TODAY } from '../../scripts/demo-config';

/**
 * V2 of docs/design/OVERHAUL.md, end to end: a category figure opens the
 * register on exactly the rows behind it. tests/flow.test.ts proves the
 * queries agree; this proves the page wiring does — the category links once
 * opened an unfiltered register because the page never read `category`.
 */

/** "$479" or "-$478.79" → cents. */
const cents = (text: string) => {
  const m = /(-?)\$([\d,]+)(?:\.(\d{2}))?/.exec(text);
  if (!m) throw new Error(`no amount in "${text}"`);
  return (m[1] ? -1 : 1) * (Number(m[2].replace(/,/g, '')) * 100 + Number(m[3] ?? 0));
};

async function expectRegisterOn(page: Page, category: string, figureCents: number) {
  await page.waitForURL(/\/transactions\?.*category=.*necessity=required/);
  await expect(page.getByText(`Only ${category} · required`)).toBeVisible();

  const categories = await page.locator('table tbody tr td:nth-child(4)').allInnerTexts();
  expect(categories.length).toBeGreaterThan(0);
  expect(new Set(categories.map((c) => c.split('\n')[0].trim()))).toEqual(new Set([category]));

  // The figure was rounded to dollars; the register prints cents.
  const spent = cents((await page.getByText(/^Spent/).first().textContent()) ?? '');
  expect(Math.round(-spent / 100)).toBe(Math.round(figureCents / 100));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${SEED_TODAY}T12:00:00-05:00`));
});

test('a category under the Flow opens the register on exactly its rows', async ({ page }) => {
  await page.goto('/flow');
  const link = page.getByRole('link', { name: 'Groceries', exact: true });
  const figure = cents((await page.locator('li', { has: link }).locator('.figure').first().textContent()) ?? '');
  await link.click();
  await expectRegisterOn(page, 'Groceries', figure);
});

test("a category on Cashflow's list opens the register on exactly its rows", async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Groceries', exact: true });
  // Cashflow's list is still net (the Month page, PR 3, makes it gross);
  // the demo's Groceries has no credits, so net and gross agree here.
  const figure = cents((await page.locator('li', { has: link }).locator('.figure').first().textContent()) ?? '');
  await link.click();
  await expectRegisterOn(page, 'Groceries', figure);
});
