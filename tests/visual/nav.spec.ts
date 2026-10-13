import { expect, test } from '@playwright/test';
import { SEED_TODAY } from '../../scripts/demo-config';

/**
 * The sections down the left edge (docs/design/OVERHAUL.md, ask 13): a full
 * sidebar on a wide screen, a rail on a tablet, a menu button on a phone —
 * the same five places, the current one marked, the period carried between
 * Flow and Register (V5).
 */

const SECTIONS = ['Flow', 'Review', 'Register', 'Accounts', 'Setup'];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${SEED_TODAY}T12:00:00-05:00`));
});

test.describe('on a wide screen', () => {
  test.skip(({ isMobile }) => isMobile, 'the phone has its own menu');

  test('the sidebar lists every section and marks the one you are on', async ({ page }) => {
    await page.goto('/accounts');
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav).toBeVisible();
    for (const name of SECTIONS) await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(nav.getByRole('link', { name: /^Accounts/ })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: /^Review \d+ outstanding$/ })).toBeVisible();
    // Fixed to the left edge, the full height of the screen.
    const box = await page.locator('aside').filter({ has: nav }).boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.height).toBe(page.viewportSize()!.height);
  });

  test('stays on the left edge while the page scrolls', async ({ page }) => {
    await page.goto('/transactions');
    await page.mouse.wheel(0, 2000);
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav.getByRole('link', { name: /^Register/ })).toBeInViewport();
  });

  test('carries the period from Flow to Register, and only there', async ({ page }) => {
    await page.goto('/?period=2026-08');
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav.getByRole('link', { name: /^Register/ })).toHaveAttribute('href', '/transactions?period=2026-08');
    await expect(nav.getByRole('link', { name: /^Accounts/ })).toHaveAttribute('href', '/accounts');
    await nav.getByRole('link', { name: /^Register/ }).click();
    await page.waitForURL(/\/transactions\?period=2026-08/);
    await expect(nav.getByRole('link', { name: /^Register/ })).toHaveAttribute('aria-current', 'page');
  });

  test('narrows to a rail on a tablet, every section still named', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/review');
    const aside = page.locator('aside').filter({ has: page.getByRole('navigation', { name: 'Sections' }) });
    expect((await aside.boundingBox())?.width).toBe(80);
    for (const name of SECTIONS) await expect(aside.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(page.getByRole('button', { name: /menu/ })).toBeHidden();
  });
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a wide screen has the sidebar');

  test('hides the sidebar behind a menu button that opens the same sections', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
    const button = page.getByRole('button', { name: 'Open the menu' });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    const nav = page.getByRole('navigation', { name: 'Sections' });
    for (const name of SECTIONS) await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(nav.getByRole('link', { name: /^Flow/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible();
  });

  test('closes on Esc and hands focus back to the button', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open the menu' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open the menu' })).toBeFocused();
  });

  test('closes on a tap outside, without moving the page beneath', async ({ page }) => {
    await page.goto('/');
    const heading = page.getByText('September 2026').first();
    const before = (await heading.boundingBox())?.y;
    await page.getByRole('button', { name: 'Open the menu' }).click();
    expect((await heading.boundingBox())?.y).toBe(before);
    await page.mouse.click(200, 800);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
  });

  test('choosing a page goes there and closes the menu', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open the menu' }).click();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Register/ }).click();
    await page.waitForURL(/\/transactions/);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open the menu' })).toBeVisible();
  });
});
