'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { CategoryWithGroup } from '@/lib/types';

/**
 * Picking a category, ranked rather than reorganised (wireframe 34:2).
 *
 * The taxonomy is 35 categories across 8 groups, but any given month is spent
 * in about four of them. An alphabetical select makes every pick a scan of the
 * whole list; this surfaces the merchant's memory, then the machine's guess,
 * then what you reach for most, and filters as you type.
 *
 * Ranking only — no category is hidden and nothing is reordered in the
 * database. The sections are presentation.
 */

interface Ranked {
  category: CategoryWithGroup;
  /** The right-hand annotation: why this row is where it is. */
  note?: string;
}

interface PaletteSection {
  key: string;
  label: string;
  items: Ranked[];
}

export function CategoryPalette({
  categories,
  usage,
  suggestedId,
  unconfirmedId,
  merchantDefaultId,
  merchantUses,
  currentId,
  onPick,
  onClose,
}: {
  categories: CategoryWithGroup[];
  usage: Record<string, number>;
  suggestedId?: string | null;
  /** The row's current category, when no human has confirmed it. */
  unconfirmedId?: string | null;
  merchantDefaultId?: string | null;
  merchantUses?: number;
  currentId?: string | null;
  onPick: (categoryId: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const sections = useMemo((): PaletteSection[] => {
    const q = query.trim().toLowerCase();
    const out: PaletteSection[] = [];
    // A category may qualify for several sections; it appears in the first
    // only, or the keyboard cursor lands on the same category twice.
    const claimed = new Set<string>();

    const take = (c: CategoryWithGroup | undefined): c is CategoryWithGroup =>
      !!c && !claimed.has(c.id) && matches(c, q);

    if (!q) {
      // The merchant's own memory outranks the model: it records what you
      // decided, the suggestion only guesses at it.
      const remembered = merchantDefaultId ? byId.get(merchantDefaultId) : undefined;
      if (take(remembered)) {
        claimed.add(remembered.id);
        out.push({
          key: 'merchant',
          label: 'This merchant',
          items: [{
            category: remembered,
            note: merchantUses && merchantUses > 1 ? `${merchantUses} times` : 'remembered',
          }],
        });
      }

      // `suggested_category_id` is the model's parallel opinion and is often
      // NULL — rules and the LLM write straight to category_id. So the standing
      // guess is whatever is on the row now, as long as no human confirmed it.
      const guess = suggestedId
        ? byId.get(suggestedId)
        : unconfirmedId
          ? byId.get(unconfirmedId)
          : undefined;
      if (take(guess)) {
        claimed.add(guess.id);
        out.push({
          key: 'guess',
          label: 'Best guess',
          items: [{ category: guess, note: guess.group_name }],
        });
      }
    }

    if (q) {
      const hits = categories.filter((c) => take(c));
      for (const c of hits) claimed.add(c.id);
      if (hits.length > 0) {
        out.push({
          key: 'matches',
          label: `Matches “${query.trim()}”`,
          items: hits
            .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
            .map((c) => ({ category: c, note: c.group_name })),
        });
      }
    } else {
      const used = categories
        .filter((c) => take(c) && (usage[c.id] ?? 0) > 0)
        .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
        .slice(0, 6);
      for (const c of used) claimed.add(c.id);
      if (used.length > 0) {
        out.push({
          key: 'used',
          label: 'You use most',
          items: used.map((c) => ({ category: c, note: String(usage[c.id] ?? 0) })),
        });
      }

      const rest = categories.filter((c) => take(c));
      if (rest.length > 0) {
        out.push({
          key: 'rest',
          label: 'Everything else',
          items: rest.map((c) => ({ category: c, note: c.group_name })),
        });
      }
    }

    return out;
  }, [categories, query, usage, suggestedId, unconfirmedId, merchantDefaultId, merchantUses, byId]);

  // One flat list, so ↑/↓ crosses section boundaries.
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // A shrinking list can strand the cursor past the end.
  useEffect(() => {
    setCursor((c) => (c >= flat.length ? Math.max(0, flat.length - 1) : c));
  }, [flat.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = flat[cursor]?.category;
      if (picked) onPick(picked.id);
    }
  }

  let index = -1;

  return (
    <div
      className="w-[340px] overflow-hidden rounded-sm border border-ink-500 bg-ink-800 shadow-2xl shadow-black/50"
      onKeyDown={onKeyDown}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
        placeholder="Type to filter…"
        aria-label="Filter categories"
        className="rule-b w-full bg-transparent px-3 py-2.5 text-sm text-paper outline-none placeholder:text-paper-faint"
      />

      <ul ref={listRef} className="max-h-[280px] overflow-y-auto">
        {sections.map((section) => (
          <li key={section.key}>
            <div className="eyebrow bg-ink-850 px-3 py-1.5">{section.label}</div>
            <ul>
              {section.items.map(({ category, note }) => {
                index += 1;
                const i = index;
                const active = i === cursor;
                return (
                  <li key={category.id}>
                    <button
                      data-active={active}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => onPick(category.id)}
                      className={clsx(
                        'flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors',
                        active ? 'bg-ink-700 text-paper' : 'text-paper-dim',
                      )}
                    >
                      <span className="truncate">
                        {category.name}
                        {category.id === currentId && (
                          <span className="ml-2 text-xs text-paper-faint">current</span>
                        )}
                      </span>
                      {note && (
                        <span className="shrink-0 text-xs text-paper-faint">{note}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}

        {/* onPick accepts null and RowEditor patches category_id: null for
            it, but nothing in the palette could reach that path — there was no
            way back to Uncategorized once a category was set. */}
        {!query.trim() && currentId != null && (
          <li>
            <button
              onClick={() => onPick(null)}
              className="rule-t flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm text-paper-faint transition-colors hover:bg-ink-700 hover:text-paper-dim"
            >
              <span className="truncate">Uncategorized</span>
              <span className="shrink-0 text-xs">clear</span>
            </button>
          </li>
        )}

        {flat.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-paper-faint">
            No category matches “{query.trim()}”.
          </li>
        )}
      </ul>

      <div className="rule-t px-3 py-2 text-[10px] text-paper-faint">
        ↑↓ move · ⏎ apply · esc close
      </div>
    </div>
  );
}

/** Substring match on the category or its group, so "food" finds Groceries. */
function matches(c: CategoryWithGroup, q: string): boolean {
  if (!q) return true;
  return c.name.toLowerCase().includes(q) || c.group_name.toLowerCase().includes(q);
}
