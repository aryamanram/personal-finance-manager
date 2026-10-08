'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';

/** Pages that read ?period=, and so open on the one you were looking at (V5). */
const KEEPS_PERIOD = new Set(['/', '/transactions']);

/**
 * The sections, with the current one marked.
 *
 * Client-side because it needs the pathname. Marking the active page is not
 * decoration: with five items the nav is long enough that "which page am I on"
 * stops being obvious from the heading alone.
 */
export function Nav({
  items,
}: {
  items: readonly { href: string; label: string; count?: number }[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  // Carried only between pages that share it. The value is passed through
  // as a query parameter, never as a destination (V7), and each page
  // validates it against the periods it knows.
  const period = params.get('period');

  return (
    <nav className="flex items-center gap-6">
      {items.map((item) => {
        // The Flow answers at / and at its old address. /categories/[id] is a
        // drill-down of the register and has no nav entry of its own, so it
        // marks Register rather than leaving the whole bar unlit.
        const active =
          item.href === '/'
            ? pathname === '/' || pathname.startsWith('/flow')
            : item.href === '/transactions'
              ? pathname.startsWith('/transactions') || pathname.startsWith('/categories')
              : pathname.startsWith(item.href);
        const href = period && KEEPS_PERIOD.has(item.href)
          ? `${item.href}?${new URLSearchParams({ period }).toString()}`
          : item.href;
        return (
          <Link
            key={item.href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex items-baseline gap-1.5 text-sm transition-colors',
              active ? 'font-medium text-ink' : 'text-ink-faint hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="figure rounded-sm bg-well px-1.5 text-xs text-ink-dim">
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
