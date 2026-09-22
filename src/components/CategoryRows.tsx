import Link from 'next/link';
import { Figure } from './Figure';
import type { CategoryBreakdownRow } from '@/lib/queries';

/**
 * Where the money went, as a ruled list (wireframe 40:3).
 *
 * Replaces the old narrow "Top categories" sidebar. Each row carries the two
 * axes the ledger classifies on — fixed/variable and required/discretionary —
 * spelled out rather than abbreviated to "fix · req", which was only ever a
 * response to a 360px column.
 */
export function CategoryRows({
  rows,
  from,
  to,
  limit = 12,
}: {
  rows: CategoryBreakdownRow[];
  from: string;
  to: string;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  // Scale against the largest row, not the total: against the total, every bar
  // in a well-spread month is a stub.
  const largest = shown[0]?.total_cents ?? 0;

  if (shown.length === 0) {
    return <p className="py-6 text-sm text-paper-faint">Nothing spent in this period.</p>;
  }

  return (
    <ul>
      {shown.map((r) => (
        <li
          // getCategoryBreakdownRange groups by necessity too, so one
          // category can return two rows; the id alone is not unique here.
          key={`${r.category_id ?? r.category_name}|${r.necessity}`}
          className="rule-b grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-3 sm:grid-cols-[200px_minmax(0,1fr)_120px]"
        >
          <div className="min-w-0">
            <Link
              href={
                r.category_id
                  ? `/transactions?category=${r.category_id}&from=${from}&to=${to}`
                  : `/transactions?uncategorized=1&from=${from}&to=${to}`
              }
              className="block truncate text-sm text-paper transition-colors hover:text-paper-dim"
            >
              {r.category_name}
            </Link>
            <div className="mt-0.5 truncate text-xs text-paper-faint">
              {r.category_group_name} · {r.cost_type} · {r.necessity}
            </div>
          </div>

          <div className="hidden h-[6px] rounded-[1px] bg-ink-700 sm:block" aria-hidden>
            <div
              className="h-full rounded-[1px]"
              style={{
                width: largest > 0 ? `${(r.total_cents / largest) * 100}%` : '0%',
                /* Required vs discretionary is the distinction the ledger is
                   built on, so the bar carries it. Both are outflow tones —
                   the pair separates by lightness, not hue (globals.css). */
                background:
                  r.necessity === 'required'
                    ? 'var(--color-flow-required)'
                    : 'var(--color-flow-discretionary)',
              }}
            />
          </div>

          <Figure
            cents={r.total_cents}
            tone="neutral"
            showCents={false}
            className="text-right text-sm"
          />
        </li>
      ))}
    </ul>
  );
}
