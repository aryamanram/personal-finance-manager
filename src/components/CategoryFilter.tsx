'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import type { CategoryWithGroup } from '@/lib/types';

/**
 * The register's category filter: multi-select, grouped, one level deep.
 *
 * Checking a PARENT checks its subcategories with it — a parent is a heading
 * over its children here, not a rival to them.
 *
 * The default is everything EXCEPT the excluded set (Credit Card Payment).
 * That is why the URL carries what is hidden (`hide=`) rather than what is
 * shown: an empty param has to mean "the default", and the default is not
 * "everything". Encoding the shown set would make a fresh URL and a
 * deliberately-empty selection indistinguishable.
 */
export function CategoryFilter({
  categories,
  hiddenIds,
  defaultHiddenIds,
}: {
  categories: CategoryWithGroup[];
  /** Currently hidden, from the URL. */
  hiddenIds: string[];
  /** Hidden when the URL says nothing — the categories that start off. */
  defaultHiddenIds: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  /**
   * Collapsed groups and parents, by name.
   *
   * Collapsing is a VIEW of the panel, not a filter — a hidden section's
   * categories keep whatever state they had, so folding Housing away never
   * changes which rows the register shows. The counts on a collapsed header
   * are what make that safe to trust: they say what is inside without
   * opening it.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);

  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);

  const toggleCollapse = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Groups, each with its top-level categories and their children. */
  const tree = useMemo(() => {
    const byGroup = new Map<string, { parent: CategoryWithGroup; kids: CategoryWithGroup[] }[]>();
    for (const c of categories) {
      if (c.parent_id) continue;
      if (!byGroup.has(c.group_name)) byGroup.set(c.group_name, []);
      byGroup.get(c.group_name)!.push({
        parent: c,
        kids: categories.filter((k) => k.parent_id === c.id),
      });
    }
    return [...byGroup.entries()];
  }, [categories]);

  function commit(next: Set<string>) {
    const p = new URLSearchParams(params.toString());
    // The DEFAULT set is written as an absent param, so that a link reads the
    // same as a fresh page load and does not pin today's default forever.
    const isDefault =
      next.size === defaultHiddenIds.length
      && defaultHiddenIds.every((id) => next.has(id));
    if (isDefault) p.delete('hide');
    else if (next.size === 0) p.set('hide', 'none');
    // Past the halfway mark, name what is SHOWN instead. "Hide all, then tick
    // three" otherwise spells out 55 uuids — a 2,000-character URL for a
    // three-category view, which is unreadable and brittle to paste.
    else if (next.size > categories.length / 2) {
      const shown = categories.filter((c) => !next.has(c.id)).map((c) => c.id);
      p.set('hide', shown.length === 0 ? 'all' : `only:${shown.join(',')}`);
    } else p.set('hide', [...next].join(','));
    const q = p.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  }

  /** A category and its children move together. */
  function toggle(c: CategoryWithGroup, kids: CategoryWithGroup[]) {
    const next = new Set(hidden);
    const ids = [c.id, ...kids.map((k) => k.id)];
    const showing = !hidden.has(c.id);
    for (const id of ids) {
      if (showing) next.add(id);
      else next.delete(id);
    }
    commit(next);
  }

  function toggleOne(c: CategoryWithGroup) {
    const next = new Set(hidden);
    if (next.has(c.id)) next.delete(c.id);
    else next.add(c.id);
    commit(next);
  }

  const hiddenCount = hiddenIds.length;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5 transition-colors hover:border-ink-500"
      >
        <span>
          {hiddenCount === 0
            ? 'All categories'
            : `Categories · ${hiddenCount} hidden`}
        </span>
        <span aria-hidden className="shrink-0 text-paper-faint">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[300px] overflow-hidden rounded-sm border border-ink-500 bg-ink-800 shadow-2xl shadow-black/50">
          <div className="rule-b flex items-center gap-3 px-3 py-2 text-[10px]">
            {/* Selection, then view. These do different things and undoing
                one must not undo the other: Show all / Reset change which
                rows the register shows, Fold only changes this panel. */}
            <button
              type="button"
              onClick={() => commit(new Set())}
              className="text-paper-faint transition-colors hover:text-paper"
            >
              Show all
            </button>
            {/* The starting point for "only these": clear the board, then
                tick the two or three you want. Without it, isolating one
                category means unticking the other fifty-seven. */}
            <button
              type="button"
              onClick={() => commit(new Set(categories.map((c) => c.id)))}
              className="text-paper-faint transition-colors hover:text-paper"
            >
              Hide all
            </button>
            <button
              type="button"
              onClick={() => commit(new Set(defaultHiddenIds))}
              className="text-paper-faint transition-colors hover:text-paper"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() =>
                setCollapsed((c) =>
                  c.size > 0 ? new Set() : new Set(tree.map(([g]) => g)))
              }
              className="ml-auto text-paper-faint transition-colors hover:text-paper"
            >
              {collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
            </button>
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {tree.map(([group, entries]) => {
              const groupShut = collapsed.has(group);
              // Counted over the group's WHOLE subtree, so a collapsed header
              // still says how much of what it contains is on.
              const all = entries.flatMap((e) => [e.parent, ...e.kids]);
              const showing = all.filter((c) => !hidden.has(c.id)).length;

              return (
                <div key={group}>
                  <button
                    type="button"
                    onClick={() => toggleCollapse(group)}
                    aria-expanded={!groupShut}
                    className="eyebrow rule-b sticky top-0 z-10 flex w-full items-center gap-1.5 bg-ink-900 px-3 py-1.5 text-left transition-colors hover:text-paper-dim"
                  >
                    <span aria-hidden className="w-2 shrink-0 text-paper-faint">
                      {groupShut ? '›' : '⌄'}
                    </span>
                    <span className="truncate">{group}</span>
                    <span className="ml-auto shrink-0 text-paper-faint">
                      {showing}/{all.length}
                    </span>
                  </button>

                  {!groupShut && entries.map(({ parent, kids }) => {
                    const parentKey = `${group}:${parent.id}`;
                    const parentShut = collapsed.has(parentKey);
                    const kidsShowing = kids.filter((k) => !hidden.has(k.id)).length;

                    return (
                      <div key={parent.id}>
                        <Row
                          label={parent.name}
                          checked={!hidden.has(parent.id)}
                          onChange={() => toggle(parent, kids)}
                          // Only a parent with children gets a disclosure, so
                          // a leaf category has nothing extra to ignore.
                          disclosure={kids.length > 0
                            ? {
                                collapsed: parentShut,
                                count: `${kidsShowing}/${kids.length}`,
                                onToggle: () => toggleCollapse(parentKey),
                              }
                            : undefined}
                        />
                        {!parentShut && kids.map((k) => (
                          <Row
                            key={k.id}
                            label={k.name}
                            checked={!hidden.has(k.id)}
                            onChange={() => toggleOne(k)}
                            indent
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  checked,
  onChange,
  indent,
  disclosure,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  indent?: boolean;
  /** Fold this row's subcategories away. Absent on a row with none. */
  disclosure?: { collapsed: boolean; count: string; onToggle: () => void };
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-2 py-1.5 pr-3 text-sm transition-colors hover:bg-ink-700',
        indent ? 'pl-8 text-paper-dim' : 'pl-3 text-paper',
      )}
    >
      {/* The checkbox and the disclosure are separate controls: clicking a
          <label> that wrapped both would toggle the checkbox while trying to
          fold the section. */}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="accent-edited"
        />
        <span className="truncate">{label}</span>
      </label>

      {disclosure && (
        <button
          type="button"
          onClick={disclosure.onToggle}
          aria-expanded={!disclosure.collapsed}
          aria-label={`${disclosure.collapsed ? 'Expand' : 'Collapse'} ${label}`}
          className="shrink-0 text-xs text-paper-faint transition-colors hover:text-paper"
        >
          {disclosure.count} <span aria-hidden>{disclosure.collapsed ? '›' : '⌄'}</span>
        </button>
      )}
    </div>
  );
}
