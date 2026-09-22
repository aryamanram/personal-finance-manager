'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/**
 * The four sections, with the current one marked (wireframe 27:3).
 *
 * Client-side because it needs the pathname. Marking the active page is not
 * decoration: with four items the nav is long enough that "which page am I on"
 * stops being obvious from the heading alone.
 */
export function Nav({
  items,
}: {
  items: readonly { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-6">
      {items.map((item) => {
        // Exact match for the dashboard, prefix match elsewhere — otherwise
        // "/" lights up on every page, and /categories/[id] (a drill-down of
        // the register) lights up nothing.
        const active =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'text-sm transition-colors',
              active ? 'text-paper' : 'text-paper-dim hover:text-paper',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
