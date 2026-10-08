import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PAGES, openDemoPage } from './pages';

interface Known {
  /** The axe rule; color-contrast also names the failing foreground colour. */
  rule: string;
  /** How many elements fail it, per page and viewport. */
  count: number;
  pages: string[];
  projects?: string[];
}

/**
 * What axe finds today. Each entry is a defect to fix, not a waiver.
 *
 * The comparison is exact: a page that gains a violation fails, and so does
 * one where a listed violation is fixed. The list can only shrink, and only
 * by deleting the line that a fix made untrue.
 */
const KNOWN: Known[] = [
  // Outflow blue on the ink ground: 3.61:1, and 3.36:1 on a raised surface;
  // WCAG AA needs 4.5:1 at 12px. A token change, for the colour pass.
  { rule: 'color-contrast #3a6ea5', count: 2, pages: ['cashflow'] },
  { rule: 'color-contrast #3a6ea5', count: 1, pages: ['register', 'register-filtered'] },
  // Invest violet: 4.39:1.
  { rule: 'color-contrast #7c6bc9', count: 1, pages: ['cashflow'] },
  // FilterChips are links carrying aria-pressed, which links do not allow.
  { rule: 'aria-allowed-attr', count: 3, pages: ['register', 'register-filtered'] },
  // The register's account filter <select> has no accessible name.
  { rule: 'select-name', count: 1, pages: ['register', 'register-filtered'] },
  // The accounts page: an unlabelled <select> and the balance form's date input.
  { rule: 'select-name', count: 1, pages: ['accounts'] },
  { rule: 'label', count: 1, pages: ['accounts'] },
  // The Sankey scrolls sideways on a phone but cannot be reached by keyboard.
  { rule: 'scrollable-region-focusable', count: 1, pages: ['flow'], projects: ['mobile'] },
];

function expected(page: string, project: string): string[] {
  return KNOWN
    .filter((k) => k.pages.includes(page) && (!k.projects || k.projects.includes(project)))
    .map((k) => `${k.rule} ×${k.count}`)
    .sort();
}

for (const p of PAGES) {
  test(`${p.name} has only the known WCAG 2.1 A/AA violations`, async ({ page }, info) => {
    await openDemoPage(page, p);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('nextjs-portal')
      .analyze();

    const counts = new Map<string, number>();
    for (const v of violations) {
      for (const node of v.nodes) {
        const fg = v.id === 'color-contrast'
          ? ` ${(node.any[0]?.data as { fgColor?: string } | undefined)?.fgColor ?? '?'}`
          : '';
        const key = v.id + fg;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const found = [...counts].map(([rule, n]) => `${rule} ×${n}`).sort();
    expect(found).toEqual(expected(p.name, info.project.name));
  });
}
