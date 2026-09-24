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

describe('a drill row names the level it opens', () => {
  /**
   * The bug: the click handler inferred the target level from current state
   * ("if a group is open, this row must be a parent"). With a shortcut section
   * pinned above the tree the panel does not return to level 1 between
   * clicks, so a GROUP row clicked while a group was already open jumped
   * straight to level 3 — opening a row's category went directly to
   * Subscriptions' children, skipping the rest of Lifestyle.
   *
   * The row itself now says where it goes, so the same row behaves the same
   * way whatever else is on screen.
   */
  it('tags group rows as opening a group', () => {
    const sections = browseSections(TAXONOMY, null, null, back);
    expect(sections[0]!.drill!.every((d) => d.into === 'group')).toBe(true);
  });

  it('tags parent rows as opening a parent', () => {
    const sections = browseSections(TAXONOMY, 'Lifestyle', null, back);
    expect(sections[0]!.drill!).toEqual([
      { name: 'Subscriptions', count: 3, into: 'parent' },
    ]);
  });
});

describe('nothing is pinned above the tree', () => {
  /**
   * Every shortcut tried above the tree caused the same bug, twice reported:
   * clicking a GROUP landed inside one of its parents instead of on the
   * group's own categories.
   *
   * The mechanism was that a pinned section claimed its category out of the
   * list the tree was then built from, AND kept the panel from returning to
   * level 1 between clicks. So the tree is now built from the whole visible
   * list, with no section above it, and the levels are a pure function of
   * (categories, openGroup, openParent) — which is what these assert.
   */
  it('shows the same group list whatever the row is currently filed as', () => {
    // The CCBill case: the row sits in Adult, a SUBCATEGORY of Subscriptions.
    // A pinned "best guess" for it used to remove Adult from the tree.
    const sections = browseSections(TAXONOMY, 'Lifestyle', null, back);
    expect(drillNames(sections)).toEqual(['Subscriptions']);
    expect(itemNames(sections).sort()).toEqual(['Entertainment', 'Shopping']);
  });

  it('opening a group never lands inside one of its parents', () => {
    // Level 2 must list the group's own categories, not a parent's children.
    const sections = browseSections(TAXONOMY, 'Lifestyle', null, back);
    expect(sections[0]!.label).toBe('Lifestyle');
    expect(itemNames(sections)).not.toContain('Adult');
    expect(itemNames(sections)).not.toContain('Streaming & Video');
  });

  it('depends only on the taxonomy and where you are', () => {
    // Called twice with the same arguments, it returns the same shape — there
    // is no per-row state that could move a category out of the tree.
    const a = browseSections(TAXONOMY, 'Lifestyle', null, back);
    const b = browseSections(TAXONOMY, 'Lifestyle', null, back);
    expect(drillNames(a)).toEqual(drillNames(b));
    expect(itemNames(a)).toEqual(itemNames(b));
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
