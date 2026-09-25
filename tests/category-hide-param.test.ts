/**
 * How the register's `hide` param encodes a category selection.
 *
 * The param carries what is HIDDEN, because the default is not "everything" —
 * Credit Card Payment starts off, so an absent param must mean the default
 * rather than "nothing hidden". That forces explicit spellings for the two
 * ends, and a flip past the halfway mark so that "show only these three" is
 * not written as fifty-five uuids.
 */
import { describe, it, expect } from 'vitest';
import { resolveHidden } from '@/app/transactions/page';
import type { CategoryWithGroup } from '@/lib/types';

const cat = (id: string): CategoryWithGroup => ({
  id, group_id: 'g', name: id, parent_id: null, parent_name: null,
  icon: null, color: null, default_cost_type: 'variable',
  default_necessity: 'discretionary', is_archived: false, sort_order: 0,
  group_name: 'G', group_sort_order: 0,
});

const ALL = ['a', 'b', 'c', 'd'].map(cat);
const DEFAULT = ['d'];

describe('resolveHidden', () => {
  it('falls back to the default when the param is absent', () => {
    // NOT "nothing hidden": the register starts with card payments off.
    expect(resolveHidden(undefined, ALL, DEFAULT)).toEqual(['d']);
    expect(resolveHidden('', ALL, DEFAULT)).toEqual(['d']);
  });

  it('distinguishes "hide nothing" from "nothing was said"', () => {
    // This is the whole reason the param needs an explicit 'none'.
    expect(resolveHidden('none', ALL, DEFAULT)).toEqual([]);
  });

  it('hides everything on "all"', () => {
    expect(resolveHidden('all', ALL, DEFAULT)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reads an explicit hide list', () => {
    expect(resolveHidden('a,c', ALL, DEFAULT)).toEqual(['a', 'c']);
  });

  it('inverts an only: list', () => {
    // "show only b" means "hide a, c and d".
    expect(resolveHidden('only:b', ALL, DEFAULT)).toEqual(['a', 'c', 'd']);
    expect(resolveHidden('only:a,b', ALL, DEFAULT)).toEqual(['c', 'd']);
  });

  it('treats only: with nothing after it as hiding everything', () => {
    expect(resolveHidden('only:', ALL, DEFAULT)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores ids that no longer exist', () => {
    // A stale link outliving a deleted category must not resurrect it.
    expect(resolveHidden('only:b,gone', ALL, DEFAULT)).toEqual(['a', 'c', 'd']);
  });

  it('round-trips every selection', () => {
    // Whichever spelling the component picks, resolving it must return the
    // selection that produced it — that is the property the flip could break.
    for (const hidden of [[], ['a'], ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
      const set = new Set(hidden);
      const param =
        hidden.length === 0 ? 'none'
        : hidden.length > ALL.length / 2
          ? (() => {
              const shown = ALL.filter((c) => !set.has(c.id)).map((c) => c.id);
              return shown.length === 0 ? 'all' : `only:${shown.join(',')}`;
            })()
          : hidden.join(',');
      expect(resolveHidden(param, ALL, DEFAULT).sort()).toEqual([...hidden].sort());
    }
  });
});
