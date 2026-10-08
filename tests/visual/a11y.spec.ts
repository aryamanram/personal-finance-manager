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

const REGISTER = ['register', 'register-filtered'];

/**
 * What axe finds today. Each entry is a defect to fix, not a waiver.
 *
 * The comparison is exact and per element: a new violation fails, a fixed
 * one fails until its line is deleted, and so does trading one failing
 * element for another under the same rule.
 */
const KNOWN: Known[] = [
  // Outflow blue on the ink ground: 3.61:1, and 3.36:1 on a raised surface;
  // WCAG AA needs 4.5:1 at 12px. A token change, for the colour pass.
  { rule: 'color-contrast', element: 'span "▼ 50.0%"', pages: ['cashflow'] },
  { rule: 'color-contrast', element: 'span "▼ 75.5%"', pages: ['cashflow'] },
  { rule: 'color-contrast', element: 'a[aria-pressed=true][href=/transactions?from&to] "All"', pages: ['register'] },
  { rule: 'color-contrast', element: 'a[aria-pressed=true][href=/transactions?category&from&to] "All"', pages: ['register-filtered'] },
  // Invest violet: 4.39:1.
  { rule: 'color-contrast', element: 'span "$2,000"', pages: ['cashflow'] },
  // FilterChips are links carrying aria-pressed, which links do not allow.
  { rule: 'aria-allowed-attr', element: 'a[aria-pressed=true][href=/transactions?from&to] "All"', pages: ['register'] },
  { rule: 'aria-allowed-attr', element: 'a[aria-pressed=false][href=/transactions?from&review&to] "Needs review · 35"', pages: ['register'] },
  { rule: 'aria-allowed-attr', element: 'a[aria-pressed=false][href=/transactions?from&to&voided] "Voided"', pages: ['register'] },
  { rule: 'aria-allowed-attr', element: 'a[aria-pressed=true][href=/transactions?category&from&to] "All"', pages: ['register-filtered'] },
  { rule: 'aria-allowed-attr', element: 'a[aria-pressed=false][href=/transactions?category&from&review&to] "Needs review · 35"', pages: ['register-filtered'] },
  { rule: 'aria-allowed-attr', element: 'a[aria-pressed=false][href=/transactions?category&from&to&voided] "Voided"', pages: ['register-filtered'] },
  // The register's account filter has no accessible name.
  { rule: 'select-name', element: 'select[name=account] "All accountsChase Total Checking"', pages: REGISTER },
  // The accounts page: the snapshot form's account <select> and date input.
  { rule: 'select-name', element: 'select "Apple CardChase United Explorer"', pages: ['accounts'] },
  { rule: 'label', element: 'input[type=date]', pages: ['accounts'] },
  // The Sankey scrolls sideways on a phone but cannot be reached by keyboard.
  { rule: 'scrollable-region-focusable', element: 'figure "Income → Available $5,400.00From"', pages: ['flow'], projects: ['mobile'] },
];

/**
 * Names an element by what it is, not where it sits: its tag, the attributes
 * that identify it, and the start of its text. Classes are left out, so a
 * restyle does not churn this list; ids and dates in an href are reduced to
 * the query's keys, since the demo's category ids are random per seed.
 */
async function signature(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return `(gone: ${sel})`;
    const attrs = ['name', 'type', 'role', 'aria-pressed', 'href']
      .filter((a) => el.hasAttribute(a))
      .map((a) => {
        const v = el.getAttribute(a) ?? '';
        if (a !== 'href') return `${a}=${v}`;
        const u = new URL(v, location.origin);
        const keys = [...new Set(u.searchParams.keys())].sort();
        return `href=${u.pathname}${keys.length ? `?${keys.join('&')}` : ''}`;
      });
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
    return `${el.tagName.toLowerCase()}${attrs.map((a) => `[${a}]`).join('')}${text ? ` "${text}"` : ''}`;
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
