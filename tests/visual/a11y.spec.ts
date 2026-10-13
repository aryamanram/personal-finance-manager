import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PAGES, openDemoPage } from './pages';

interface Known {
  rule: string;
  /** The failing element, as signature() writes it. */
  element: string;
  pages: string[];
  projects?: string[];
}

/**
 * What axe finds today. Each entry is a defect to fix, not a waiver.
 *
 * The comparison is exact and per element: a new violation fails, a fixed
 * one fails until its line is deleted, and so does trading one failing
 * element for another under the same rule. Emptied by the overhaul's colour
 * and accessibility pass; keep it that way.
 */
const KNOWN: Known[] = [];

/**
 * Names an element by what it is, not where it sits: its tag, the attributes
 * that identify it, the start of its text, and the heading of the section it
 * is in — so the same control repeated per account (the balance form) is told
 * apart by the account's name. Classes are left out, so a restyle does not
 * churn this list; ids and dates in an href are reduced to the query's keys,
 * since the demo's category ids are random per seed.
 */
async function signature(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return `(gone: ${sel})`;
    const attrs = ['name', 'type', 'role', 'aria-pressed', 'aria-current', 'href']
      .filter((a) => el.hasAttribute(a))
      .map((a) => {
        const v = el.getAttribute(a) ?? '';
        if (a !== 'href') return `${a}=${v}`;
        const u = new URL(v, location.origin);
        const keys = [...new Set(u.searchParams.keys())].sort();
        return `href=${u.pathname}${keys.length ? `?${keys.join('&')}` : ''}`;
      });
    const clip = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
    const text = clip(el.textContent);
    const section = clip(el.closest('section')?.querySelector('h1, h2, h3')?.textContent);
    return `${el.tagName.toLowerCase()}${attrs.map((a) => `[${a}]`).join('')}${text ? ` "${text}"` : ''}`
      + (section ? ` in "${section}"` : '');
  }, selector);
}

function expected(page: string, project: string): string[] {
  return KNOWN
    .filter((k) => k.pages.includes(page) && (!k.projects || k.projects.includes(project)))
    .map((k) => `${k.rule} | ${k.element}`)
    .sort();
}

for (const p of PAGES) {
  test(`${p.name} has only the known WCAG 2.1 A/AA violations`, async ({ page }, info) => {
    await openDemoPage(page, p);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('nextjs-portal')
      .analyze();

    const found: string[] = [];
    for (const v of violations) {
      for (const node of v.nodes) {
        found.push(`${v.id} | ${await signature(page, String(node.target[0]))}`);
      }
    }
    expect(found.sort()).toEqual(expected(p.name, info.project.name));
  });
}
