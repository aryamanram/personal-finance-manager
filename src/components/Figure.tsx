'use client';

import { formatCents } from '@/money';
import clsx from 'clsx';

/**
 * The only way a monetary value reaches the screen. Tabular figures so columns
 * align on the decimal; a dotted amber underline when the user corrected the
 * value, with the bank's original on hover (DESIGN.md §7).
 */
export function Figure({
  cents,
  original,
  signed = false,
  showCents = true,
  tone = 'auto',
  className,
}: {
  cents: number | null | undefined;
  /** The raw synced value, when an override is in play. */
  original?: number | null;
  signed?: boolean;
  showCents?: boolean;
  tone?: 'auto' | 'in' | 'out' | 'neutral' | 'invest';
  className?: string;
}) {
  const edited = original !== null && original !== undefined && original !== cents;

  const toneClass =
    tone === 'neutral' ? 'text-ink'
    : tone === 'in' ? 'text-earned'
    // Spending and investing are not alarms: they print in ink, and the
    // sign says which way the money went. Only earned money has a colour.
    : tone === 'out' || tone === 'invest' ? 'text-ink'
    : cents == null ? 'text-ink-faint'
    : cents > 0 ? 'text-earned'
    : cents < 0 ? 'text-ink'
    : 'text-ink-dim';

  return (
    <span
      className={clsx('figure', toneClass, edited && 'edited', className)}
      title={edited ? `Bank reported ${formatCents(original)} — corrected by hand` : undefined}
    >
      {formatCents(cents, { signed, cents: showCents })}
    </span>
  );
}
