import { expect, test, type Page } from '@playwright/test';
import { SEED_TODAY } from '../../scripts/demo-config';

/**
 * V2 of docs/design/OVERHAUL.md, end to end: every number on the Flow page
 * opens the register on exactly the rows behind it, and the register prints
 * that same number, to the cent. tests/flow.test.ts proves the queries agree;
 * this proves the page wiring does — the category links once opened an
 * unfiltered register because the page never read `category`.
 */

/** "$479.00", "-$478.79", "+$45.66" → cents. */
const cents = (text: string) => {
  const m = /([-+]?)\$([\d,]+)\.(\d{2})/.exec(text);
  if (!m) throw new Error(`no amount in "${text}"`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2].replace(/,/g, '')) * 100 + Number(m[3]));
};

/** The register's totals line, read back: spent, credits, received, invested. */
async function registerTotals(page: Page) {
  await page.waitForURL(/\/transactions\?/);
  const line = (await page.locator('[data-totals]').innerText()).replace(/\s+/g, ' ');
  const after = (label: string) => {
    const m = new RegExp(`${label} ([-+]?\\$[\\d,]+\\.\\d{2})`, 'i').exec(line);
    return m ? Math.abs(cents(m[1])) : 0;
  };
  return { spent: after('Spent'), credits: after('credits'), received: after('Received'), invested: after('Invested') };
}

/** Both Flows as charts — a phone opens on their tables. */
async function openCharts(page: Page) {
  await page.goto('/');
  for (const b of await page.getByRole('button', { name: 'Chart', exact: true }).all()) await b.click();
}

async function openTable(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Table', exact: true }).first().click();
}

/** A row of the Flow table: its link, and the amount in the same row. */
async function tableRow(page: Page, name: string) {
  const link = page.getByRole('link', { name, exact: true }).first();
  const amount = cents(await page.locator('tr', { has: link }).locator('td').first().innerText());
  return { link, amount };
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${SEED_TODAY}T12:00:00-05:00`));
});

test('a category in the Flow table opens exactly its rows, subcategories included', async ({ page }) => {
  await openTable(page);
  const { link, amount } = await tableRow(page, 'Restaurants');
  await link.click();
  await expect(page.getByText('Only Restaurants and its subcategories · discretionary')).toBeVisible();
  // Every row is Restaurants or one of its subcategories.
  const filed = await page.locator('table tbody tr td:nth-child(4)').allInnerTexts();
  expect(filed.length).toBeGreaterThan(0);
  for (const f of filed) expect(['Dining out', 'Takeout', 'Restaurants']).toContain(f.split('\n')[0].trim());
  expect((await registerTotals(page)).spent).toBe(amount);
});

test('a subcategory in the Flow table opens only its own rows', async ({ page }) => {
  await openTable(page);
  const { link, amount } = await tableRow(page, 'Takeout');
  await link.click();
  await expect(page.getByText('Only Takeout · discretionary')).toBeVisible();
  expect((await registerTotals(page)).spent).toBe(amount);
});

test('a figure opens its bucket, and the register prints the figure', async ({ page }) => {
  for (const [label, key] of [['Required', 'spent'], ['Discretionary', 'spent'], ['Income', 'received'], ['Invested', 'invested']] as const) {
    await page.goto('/');
    // The whole card is the link; its first amount is the figure.
    const figure = page.locator('a', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`, 'i') }) });
    const shown = cents(await figure.innerText());
    await figure.click();
    expect((await registerTotals(page))[key], label).toBe(shown);
  }
});

test('clicking a category in the chart looks inside it', async ({ page }) => {
  await openCharts(page);
  const node = page.locator('svg[aria-label^="Where"] g[role="button"][aria-label^="Groceries,"]');
  const amount = cents((await node.getAttribute('aria-label'))!);
  await node.click();
  await page.waitForURL(/focus=/);
  const inside = page.locator('#inside');
  await expect(inside.getByRole('button', { name: /Choose another category/ })).toContainText('Groceries');
  // The category's own Flow starts from the same number the main one drew.
  const root = inside.locator('g[role="button"][aria-label^="Groceries,"]');
  expect(cents((await root.getAttribute('aria-label'))!)).toBe(amount);
  // And its rows are one click further: the register on that number.
  await inside.getByRole('link', { name: 'open in the register' }).click();
  expect((await registerTotals(page)).spent).toBe(amount);
});

test("a merchant in a category's own Flow opens exactly its rows", async ({ page }) => {
  await openCharts(page);
  const node = page.locator('#inside g[role="button"][aria-label^="Chipotle,"]');
  const amount = cents((await node.getAttribute('aria-label'))!);
  await node.click();
  expect((await registerTotals(page)).spent).toBe(amount);
  const descriptions = await page.locator('table tbody tr td:nth-child(3)').allInnerTexts();
  for (const d of descriptions) expect(d).toMatch(/CHIPOTLE/);
});

test('the Credits source opens the money that came back', async ({ page }) => {
  await openCharts(page);
  const node = page.locator('g[role="button"][aria-label^="Credits,"]');
  const amount = cents((await node.getAttribute('aria-label'))!);
  await node.click();
  expect((await registerTotals(page)).credits).toBe(amount);
});

test('the chart is usable from the keyboard', async ({ page }) => {
  await openCharts(page);
  const node = page.locator('svg[aria-label^="Where"] g[role="button"][aria-label^="Restaurants,"]');
  await node.focus();
  await expect(page.getByRole('tooltip')).toContainText('Restaurants');
  await page.keyboard.press('Enter');
  await page.waitForURL(/focus=/);
  await expect(page.locator('#inside').getByRole('button', { name: /Choose another category/ })).toContainText('Restaurants');
});
