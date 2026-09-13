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
    tone === 'neutral' ? 'text-paper'
    : tone === 'in' ? 'text-in'
    : tone === 'out' ? 'text-out'
    : tone === 'invest' ? 'text-invest'
    : cents == null ? 'text-paper-faint'
    : cents > 0 ? 'text-in'
    : cents < 0 ? 'text-paper'
    : 'text-paper-dim';

  return (
    <span
      className={clsx('figure', toneClass, edited && 'edited', className)}
      title={edited ? `Bank reported ${formatCents(original)} — corrected by hand` : undefined}
    >
      {formatCents(cents, { signed, cents: showCents })}
    </span>
  );
}
