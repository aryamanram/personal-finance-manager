import { expect, test, type Page } from '@playwright/test';
import { SEED_TODAY } from '../../scripts/demo-config';

/**
 * The "Inside a category" picker folds: a group folds away, a parent folds
 * its subcategories, from the mouse and from the keyboard, and a search sees
 * through every fold.
 */

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${SEED_TODAY}T12:00:00-05:00`));
  await page.goto('/');
  // Each test starts with nothing folded from a previous one.
  await page.evaluate(() => window.localStorage.removeItem('ledger.inside-picker.v1'));
  await page.reload();
});

async function openPicker(page: Page) {
  await page.locator('#inside').getByRole('button', { name: /Choose another category/ }).click();
  return page.getByRole('tree', { name: 'Categories' });
}
const item = (tree: ReturnType<Page['getByRole']>, name: RegExp) => tree.getByRole('treeitem', { name });

test('a group folds away and unfolds again', async ({ page }) => {
  const tree = await openPicker(page);
  await expect(item(tree, /^Groceries/)).toBeVisible();
  await item(tree, /^Food/).click();
  await expect(item(tree, /^Food/)).toHaveAttribute('aria-expanded', 'false');
  await expect(item(tree, /^Groceries/)).toHaveCount(0);
  await item(tree, /^Food/).click();
  await expect(item(tree, /^Groceries/)).toBeVisible();
});

test('a parent folds its subcategories, and the fold is remembered', async ({ page }) => {
  const tree = await openPicker(page);
  const shopping = item(tree, /^Shopping/);
  await expect(shopping).toHaveAttribute('aria-expanded', 'false');
  await expect(item(tree, /^Clothing/)).toHaveCount(0);
  await shopping.getByTitle('Unfold Shopping').click();
  await expect(item(tree, /^Clothing/)).toBeVisible();
  await expect(item(tree, /^Household/)).toBeVisible();

  await page.reload();
  const again = await openPicker(page);
  await expect(item(again, /^Clothing/)).toBeVisible();
});

test('the keyboard folds and unfolds: → opens, ← folds or steps out', async ({ page }) => {
  const tree = await openPicker(page);
  const input = page.getByRole('combobox', { name: 'Find a category' });
  // Walk to Shopping, then open it.
  for (let i = 0; i < 40; i++) {
    const active = await input.getAttribute('aria-activedescendant');
    if (active && (await page.locator(`[id="${active}"]`).innerText()).startsWith('Shopping')) break;
    await input.press('ArrowDown');
  }
  await input.press('ArrowRight');
  await expect(item(tree, /^Household/)).toBeVisible();
  await input.press('ArrowLeft');
  await expect(item(tree, /^Household/)).toHaveCount(0);
  // ← again steps out to the group, and once more folds it.
  await input.press('ArrowLeft');
  await input.press('ArrowLeft');
  await expect(item(tree, /^Lifestyle/)).toHaveAttribute('aria-expanded', 'false');
  await expect(item(tree, /^Shopping/)).toHaveCount(0);
});

test('a search sees through every fold, and Enter chooses', async ({ page }) => {
  const tree = await openPicker(page);
  await item(tree, /^Lifestyle/).click();
  await page.getByRole('combobox', { name: 'Find a category' }).fill('house');
  await expect(item(tree, /^Household/)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForURL(/focus=/);
  await expect(page.locator('#inside').getByRole('button', { name: /Choose another category/ })).toContainText('Household');
});
