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
  const root = useRef<HTMLDivElement>(null);

  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);

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
    else p.set('hide', [...next].join(','));
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
          <div className="rule-b flex items-center justify-between px-3 py-2 text-[10px]">
            <button
              type="button"
              onClick={() => commit(new Set())}
              className="text-paper-faint transition-colors hover:text-paper"
            >
              Show all
            </button>
            <button
              type="button"
              onClick={() => commit(new Set(defaultHiddenIds))}
              className="text-paper-faint transition-colors hover:text-paper"
            >
              Reset
            </button>
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {tree.map(([group, entries]) => (
              <div key={group}>
                <div className="eyebrow rule-b sticky top-0 z-10 bg-ink-900 px-3 py-1.5">
                  {group}
                </div>
                {entries.map(({ parent, kids }) => (
                  <div key={parent.id}>
                    <Row
                      label={parent.name}
                      checked={!hidden.has(parent.id)}
                      onChange={() => toggle(parent, kids)}
                    />
                    {kids.map((k) => (
                      <Row
                        key={k.id}
                        label={k.name}
                        checked={!hidden.has(k.id)}
                        onChange={() => toggleOne(k)}
                        indent
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
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
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  indent?: boolean;
}) {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-center gap-2 py-1.5 pr-3 text-sm transition-colors hover:bg-ink-700',
        indent ? 'pl-8 text-paper-dim' : 'pl-3 text-paper',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="accent-edited"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}
