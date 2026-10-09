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
type NavItem = { href: string; label: string; count?: number };

export function Nav({ items }: { items: readonly NavItem[] }) {
  // Carried only between pages that share it. The value is passed through
  // as a query parameter, never as a destination (V7), and each page
  // validates it against the periods it knows.
  const period = useSearchParams().get('period');
  return <NavLinks items={items} period={period} />;
}

/**
 * The links themselves. Also the layout's Suspense fallback: reading the URL
 * suspends on the server, and a fallback of nothing painted a header with no
 * nav for the moment React takes to reveal the boundary.
 */
export function NavLinks({ items, period }: { items: readonly NavItem[]; period: string | null }) {
  const pathname = usePathname();

  return (
    <nav className="-mx-6 flex w-[calc(100%+3rem)] items-center gap-1 overflow-x-auto px-6 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
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
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
              active ? 'bg-well font-medium text-ink' : 'text-ink-dim hover:bg-well/60 hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className={clsx(
                'figure-display rounded-full px-1.5 text-[11px] font-semibold leading-[1.15rem]',
                active ? 'bg-card text-ink' : 'bg-well text-ink-dim',
              )}>
                {item.count}
                <span className="sr-only"> outstanding</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
