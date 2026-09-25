'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { CategoryPalette } from './CategoryPalette';
import type { CategoryWithGroup } from '@/lib/types';

/**
 * The register's category filter.
 *
 * It opens the SAME palette that assigns a category to a row — groups, then
 * categories, then subcategories, with typing searching every level. It was a
 * flat <select> of all 58 categories, which is the organisation the palette
 * exists to replace: one scroll, subcategories sitting beside their parents as
 * peers, and no way to search.
 *
 * Picking navigates rather than submitting the form, so the filter is a URL
 * like every other filter here — shareable, and survives a reload.
 *
 * Selecting a PARENT includes its subcategories; getTransactions resolves that
 * against rollup_category_id.
 */
export function CategoryFilter({
  categories,
  activeId,
}: {
  categories: CategoryWithGroup[];
  activeId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const active = activeId ? categories.find((c) => c.id === activeId) : undefined;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(categoryId: string | null) {
    const next = new URLSearchParams(params.toString());
    if (categoryId) next.set('category', categoryId);
    else next.delete('category');
    const q = next.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
    setOpen(false);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex max-w-[12rem] items-center gap-1.5 rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5 transition-colors hover:border-ink-500"
      >
        <span className="truncate">{active?.name ?? 'All categories'}</span>
        <span aria-hidden className="shrink-0 text-paper-faint">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1">
          <CategoryPalette
            categories={categories}
            // `currentId` marks the active filter, and is what makes the
            // palette offer its clear row — which is how you get back to
            // "All categories" without leaving the panel.
            currentId={activeId ?? null}
            clearLabel={{ name: 'All categories', hint: 'clear filter' }}
            onPick={pick}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
