import type { Page } from '@playwright/test';
import { SEED_TODAY } from '../../scripts/demo-config';

/** The demo's last month, yyyy-mm. */
const MONTH = SEED_TODAY.slice(0, 7);
function monthEnd(): string {
  const [y, m] = MONTH.split('-').map(Number);
  return `${MONTH}-${new Date(y, m, 0).getDate()}`;
}

export interface DemoPage {
  name: string;
  /** Opens the page; some are reached through a link, not a fixed URL. */
  open: (page: Page) => Promise<unknown>;
}

/**
 * Category IDs are random per seed, so the pages that take one are reached
 * from the Groceries row of the Flow's table rather than by a fixed URL.
 */
export async function groceriesHref(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Table', exact: true }).first().click();
  const href = await page.getByRole('link', { name: 'Groceries', exact: true }).getAttribute('href');
  if (!href) throw new Error('No Groceries link in the Flow table');
  return href;
}

export const PAGES: DemoPage[] = [
  { name: 'flow', open: (page) => page.goto('/') },
  {
    // Both themes are chosen, not flipped, so both are looked at.
    name: 'flow-dark',
    open: async (page) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      return page.goto('/');
    },
  },
  {
    name: 'flow-table',
    open: async (page) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Table', exact: true }).first().click();
    },
  },
  { name: 'review', open: (page) => page.goto(`/review?period=${MONTH}`) },
  // One month, the way the Flow links to it. All six months is 8,000px of
  // near-identical rows — a large baseline that adds nothing to the check.
  { name: 'register', open: (page) => page.goto(`/transactions?from=${MONTH}-01&to=${monthEnd()}`) },
  { name: 'accounts', open: (page) => page.goto('/accounts') },
  { name: 'setup', open: (page) => page.goto('/setup') },
  {
    name: 'register-filtered',
    open: async (page) => page.goto(await groceriesHref(page)),
  },
  {
    name: 'category',
    open: async (page) => {
      const id = new URL(await groceriesHref(page), 'http://x').searchParams.get('category');
      return page.goto(`/categories/${id}`);
    },
  },
];

/**
 * The demo's data ends on SEED_TODAY; the browser's clock is pinned to it too,
 * so anything the client derives from "today" (the balance form's default
 * date) renders the same on every run.
 */
export async function openDemoPage(page: Page, p: DemoPage) {
  await page.clock.setFixedTime(new Date(`${SEED_TODAY}T12:00:00-05:00`));
  await p.open(page);
  await page.waitForLoadState('networkidle');
}
