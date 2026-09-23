/**
 * How the category palette walks the taxonomy.
 *
 * Three levels: groups, then one group's categories, then one category's
 * subcategories. The bug this protects against is flattening — when
 * subcategories were added, opening Lifestyle listed its own six categories
 * AND Subscriptions' ten children together, so a parent sat beside its own
 * children as if they were peers.
 *
 * The component calls browseSections() directly, so these assert the real
 * decision rather than a copy of it.
 */
import { describe, it, expect } from 'vitest';
import { browseSections } from '@/components/CategoryPalette';
import type { CategoryWithGroup } from '@/lib/types';

const back = { onGroup: () => {}, onParent: () => {} };

/** A minimal category; only the fields the navigation reads are meaningful. */
const cat = (
  name: string,
  group_name: string,
  parent_name: string | null = null,
): CategoryWithGroup => ({
  id: `${group_name}:${name}`,
  group_id: group_name,
  name,
  parent_id: parent_name ? `${group_name}:${parent_name}` : null,
  parent_name,
  icon: null,
  color: null,
  default_cost_type: 'variable',
  default_necessity: 'discretionary',
  is_archived: false,
  sort_order: 0,
  group_name,
  group_sort_order: 0,
});

/** The shape of the real taxonomy: one group with a split category. */
const TAXONOMY: CategoryWithGroup[] = [
  cat('Rent', 'Housing'),
  cat('Utilities', 'Housing'),
  cat('Shopping', 'Lifestyle'),
  cat('Entertainment', 'Lifestyle'),
  cat('Subscriptions', 'Lifestyle'),
  cat('Streaming & Video', 'Lifestyle', 'Subscriptions'),
  cat('AI Tools', 'Lifestyle', 'Subscriptions'),
  cat('Adult', 'Lifestyle', 'Subscriptions'),
];

const drillNames = (s: ReturnType<typeof browseSections>) =>
  s[0]?.drill?.map((d) => d.name) ?? [];
const itemNames = (s: ReturnType<typeof browseSections>) =>
  s[0]?.items.map((i) => i.category.name) ?? [];

describe('level 1: the groups', () => {
  it('offers each group once', () => {
    expect(drillNames(browseSections(TAXONOMY, null, null, back)))
      .toEqual(['Housing', 'Lifestyle']);
  });

  it('counts only top-level categories, matching what the next screen shows', () => {
    // Counting all 6 Lifestyle rows would promise six and then show three.
    const groups = browseSections(TAXONOMY, null, null, back)[0]!.drill!;
    expect(groups.find((g) => g.name === 'Lifestyle')!.count).toBe(3);
  });
});

describe('level 2: one group', () => {
  const sections = browseSections(TAXONOMY, 'Lifestyle', null, back);

  it('never lists a subcategory beside its own parent', () => {
    // The actual bug: Streaming & Video, AI Tools and Adult appeared here as
    // peers of Shopping and Subscriptions.
    const shown = [...drillNames(sections), ...itemNames(sections)];
    expect(shown).not.toContain('Streaming & Video');
    expect(shown).not.toContain('AI Tools');
    expect(shown.sort()).toEqual(['Entertainment', 'Shopping', 'Subscriptions']);
  });

  it('drills a category that has children, and offers one that does not', () => {
    expect(drillNames(sections)).toEqual(['Subscriptions']);
    expect(itemNames(sections).sort()).toEqual(['Entertainment', 'Shopping']);
  });

  it('labels the screen with the group and offers a way back', () => {
    expect(sections[0]!.label).toBe('Lifestyle');
    expect(sections[0]!.back).toBe(back.onGroup);
  });

  it('shows nothing for a group whose categories were all filtered out', () => {
    expect(browseSections(TAXONOMY, 'Nonexistent', null, back)).toEqual([]);
  });
});

describe('level 3: one category', () => {
  const sections = browseSections(TAXONOMY, 'Lifestyle', 'Subscriptions', back);

  it('keeps the parent pickable, first', () => {
    // Drilling in must never REMOVE the option you started from: "some
    // subscription that is none of these" is a real answer.
    expect(itemNames(sections)[0]).toBe('Subscriptions');
    expect(sections[0]!.items[0]!.note).toBe('general');
  });

  it('then lists exactly its own children', () => {
    expect(itemNames(sections))
      .toEqual(['Subscriptions', 'Streaming & Video', 'AI Tools', 'Adult']);
  });

  it('offers nothing further to drill into', () => {
    // Depth is capped at two in the database; the UI must not imply more.
    expect(sections[0]!.drill).toBeUndefined();
  });

  it('goes back one level, to the group rather than the top', () => {
    expect(sections[0]!.back).toBe(back.onParent);
  });
});

describe('a taxonomy with no subcategories still works', () => {
  it('treats every category as a pick', () => {
    const flat = [cat('Rent', 'Housing'), cat('Utilities', 'Housing')];
    const sections = browseSections(flat, 'Housing', null, back);
    expect(drillNames(sections)).toEqual([]);
    expect(itemNames(sections)).toEqual(['Rent', 'Utilities']);
  });
});
