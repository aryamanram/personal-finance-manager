import { Figure } from './Figure';
import { formatCents, pctChange } from '@/money';
import clsx from 'clsx';

/**
 * One headline number. The delta is the point: a month's spending only means
 * something next to the month before it.
 */
export function StatCard({
  label,
  cents,
  previousCents,
  tone = 'neutral',
  hint,
  emphasis = false,
}: {
  label: string;
  cents: number | null;
  previousCents?: number | null;
  tone?: 'in' | 'out' | 'neutral' | 'invest';
  hint?: string;
  emphasis?: boolean;
}) {
  const delta =
    cents != null && previousCents != null ? pctChange(cents, previousCents) : null;

  // For spending, up is bad. For income and what's left over, up is good.
  const deltaIsGood = delta == null ? null : tone === 'out' ? delta < 0 : delta > 0;

  return (
    <div
      className={clsx(
        'rule-t pt-4',
        emphasis && 'border-t-2 border-t-ink-dim',
      )}
    >
      <div className="eyebrow">{label}</div>
      <div className="mt-2">
        <Figure
          cents={cents ?? 0}
          tone={tone}
          showCents={false}
          className={emphasis ? 'text-4xl font-semibold' : 'text-3xl font-medium'}
        />
      </div>
      <div className="mt-2 flex items-baseline gap-2 text-xs">
        {delta != null && (
          <span
            // Direction is in the arrow and the sign. Colouring "spent more"
            // red would turn the page into an alarm panel, and "good" green
            // would spend the earned-money colour on something else.
            className="figure text-ink-dim"
            title={deltaIsGood ? 'Better than the previous period' : 'Worse than the previous period'}
          >
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {previousCents != null && (
          <span className="text-ink-faint">
            from {formatCents(previousCents, { cents: false })}
          </span>
        )}
        {hint && <span className="text-ink-faint">{hint}</span>}
      </div>
    </div>
  );
}
