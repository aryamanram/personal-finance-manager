'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import type { PeriodOption } from '@/lib/periods';

/**
 * Period selector for the cashflow view.
 *
 * A Sankey pinned to the current calendar month is useless in a month with no
 * income, and misleading in a partial one. The period is a link rather than
 * local state so the view is shareable and survives a reload.
 */
export function PeriodPicker({
  options,
  active,
}: {
  options: PeriodOption[];
  active: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Period">
      {options.map((o) => {
        const next = new URLSearchParams(params.toString());
        next.set('period', o.key);
        const isActive = o.key === active;
        return (
          <Link
            key={o.key}
            href={`${pathname}?${next.toString()}`}
            aria-current={isActive ? 'page' : undefined}
            className={clsx(
              'border-b pb-0.5 text-xs transition-colors',
              isActive
                ? 'border-paper text-paper'
                : 'border-transparent text-paper-faint hover:text-paper-dim',
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
