/**
 * Each category's own shade of its group's colour (src/lib/palette.ts).
 *
 * The owner asked for siblings to be "slightly different" shades of one
 * colour — Groceries and Restaurants both orange, not the same orange — and
 * for subcategories to be offshoots of their parent, a few shades deeper.
 * These assert that, in both themes, against the seeded taxonomy plus the
 * demo's subcategories, and that the shades never wander into a reserved hue.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { categoryColors, oklchOf, type PaletteCategory } from '@/lib/palette';

const tokens = JSON.parse(readFileSync('docs/design/tokens.json', 'utf8'));

/** The schema's seeded spending taxonomy, by group, plus three split parents. */
const TAXONOMY: Record<string, string[]> = {
  Housing: ['Rent', 'Utilities', 'Internet & Phone', 'Renters Insurance', 'Home Goods'],
  Transportation: ['Car Payment', 'Auto Insurance', 'Gas', 'Parking & Tolls', 'Rideshare', 'Flights'],
  Food: ['Groceries', 'Restaurants', 'Coffee'],
  Health: ['Insurance Premium', 'Pharmacy', 'Fitness'],
  Lifestyle: ['Subscriptions', 'Shopping', 'Entertainment', 'Travel', 'Gifts', 'Cash Withdrawn', 'Uncategorized'],
  Financial: ['Tuition', 'Student Loan', 'Fees & Interest', 'Taxes'],
  Income: ['Paycheck', 'Reimbursement'],
};
const SUBS: Record<string, string[]> = {
  Restaurants: ['Dining out', 'Takeout'],
  Subscriptions: ['Streaming', 'Apps & cloud', 'Music', 'News', 'Cloud storage', 'Games', 'Software'],
  Shopping: ['Clothing', 'Household'],
};
const SLOTS = { Housing: 1, Transportation: 2, Food: 3, Health: 4, Lifestyle: 5, Financial: 6 };

const categories: PaletteCategory[] = Object.entries(TAXONOMY).flatMap(([group, names]) =>
  names.flatMap((name) => [
    { id: name, name, group_name: group, parent_id: null, sort_order: 0, default_necessity: 'discretionary' },
    ...(SUBS[name] ?? []).map((sub) => ({
      id: sub, name: sub, group_name: group, parent_id: name, sort_order: 0, default_necessity: 'discretionary',
    })),
  ]));

const colors = categoryColors(categories, SLOTS);
const THEMES = ['light', 'dark'] as const;
const hexOf = (id: string, theme: 'light' | 'dark') => {
  const m = /^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/.exec(colors[id]);
  if (!m) throw new Error(`${id} has no light-dark() colour: ${colors[id]}`);
  return theme === 'light' ? m[1] : m[2];
};
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const okDistance = (a: string, b: string) => {
  const [x, y] = [oklchOf(a), oklchOf(b)];
  const lab = (c: { l: number; c: number; h: number }) => [c.l, c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)];
  const [p, q] = [lab(x), lab(y)];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

describe('every category wears a shade of its group', () => {
  it('colours every spending category and subcategory, and nothing in an unslotted group', () => {
    for (const c of categories) {
      if (c.group_name === 'Income') expect(colors[c.id], c.name).toBeUndefined();
      else expect(colors[c.id], c.name).toMatch(/^light-dark\(/);
    }
  });

  it('depends on the taxonomy alone, not on the order it arrives in', () => {
    const shuffled = [...categories].reverse();
    expect(categoryColors(shuffled, SLOTS)).toEqual(colors);
  });

  it.each(THEMES)('keeps each category in its group\'s hue family (%s)', (theme) => {
    for (const [group, slot] of Object.entries(SLOTS)) {
      const base = oklchOf(tokens[theme].color[`group-${slot}`].$value);
      for (const name of TAXONOMY[group]) {
        const h = oklchOf(hexOf(name, theme)).h;
        expect(hueGap(h, base.h), `${name} turns too far from ${group}`).toBeLessThanOrEqual(22);
      }
    }
  });

  it.each(THEMES)('tells siblings apart (%s)', (theme) => {
    for (const names of Object.values(TAXONOMY)) {
      const hexes = names.filter((n) => colors[n]).map((n) => hexOf(n, theme));
      for (let i = 0; i < hexes.length; i++) {
        for (let j = i + 1; j < Math.min(hexes.length, i + 4); j++) {
          expect(okDistance(hexes[i], hexes[j]), `${names[i]} and ${names[j]}`).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });
});

describe('a subcategory is an offshoot of its parent', () => {
  it.each(THEMES)('stays close to its parent\'s hue and deeper than it (%s)', (theme) => {
    for (const [parent, subs] of Object.entries(SUBS)) {
      const p = oklchOf(hexOf(parent, theme));
      for (const sub of subs) {
        const c = oklchOf(hexOf(sub, theme));
        expect(hueGap(c.h, p.h), `${sub} wanders from ${parent}`).toBeLessThanOrEqual(18);
        // Deeper is darker on the light theme and lighter on the dark one —
        // further from the page, either way.
        const deeper = theme === 'light' ? p.l - c.l : c.l - p.l;
        expect(deeper, `${sub} is not deeper than ${parent}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(THEMES)('gives each offshoot of one parent its own shade (%s)', (theme) => {
    for (const subs of Object.values(SUBS)) {
      const hexes = subs.map((s) => hexOf(s, theme));
      expect(new Set(hexes).size, subs.join(', ')).toBe(hexes.length);
    }
  });
});

describe('the shades stay chart colours', () => {
  it.each(THEMES)('never turn toward the reserved amber, and stay visible (%s)', (theme) => {
    const grounds = [tokens[theme].color.ground.$value, tokens[theme].color.card.$value];
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const id of Object.keys(colors)) {
      const hex = hexOf(id, theme);
      // The edit marker's hue, ±25°: a category must never read as "edited".
      expect(hueGap(oklchOf(hex).h, 72), `${id} is amber-ish`).toBeGreaterThan(25);
      for (const g of grounds) expect(contrast(hex, g), `${id} on ${g}`).toBeGreaterThanOrEqual(2.3);
    }
  });
});
