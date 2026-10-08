import Link from 'next/link';
import clsx from 'clsx';
import { formatCents, pctChange } from '@/money';
import type { FlowModel } from '@/lib/flow';
import { registerHref } from '@/lib/register-link';

/**
 * The period in five numbers — the same ones the Flow's nodes carry, so the
 * page agrees with itself. Each opens its rows (V2), except Left over, which
 * is what remains of the others and has no rows of its own.
 *
 * The change is against the period before, at the same zoom. It is printed
 * in ink with an arrow: colouring "spent more" red would make the page an
 * alarm, and green is reserved for money earned.
 */
export function MonthFigures({
  model,
  previous,
  previousLabel,
  period,
}: {
  model: FlowModel | null;
  previous: FlowModel | null;
  /** "August", "2025" — what the change is measured from. */
  previousLabel?: string;
  period: { from: string; to: string };
}) {
  const figures = shape(model);
  const before = previous ? shape(previous) : null;
  const rows = (necessity: string) => registerHref({ necessity, ...period });
  const credits = model?.sources.find((s) => s.key === 'credits')?.cents ?? 0;

  const items: { key: string; label: string; cents: number; was?: number; href?: string; note?: string; lowerIsBetter?: boolean }[] = [
    { key: 'income', label: 'Income', cents: figures.income, was: before?.income, href: rows('income'),
      note: credits > 0 ? `and ${formatCents(credits)} back in credits` : undefined },
    { key: 'required', label: 'Required', cents: figures.required, was: before?.required, href: rows('required'), lowerIsBetter: true },
    { key: 'discretionary', label: 'Discretionary', cents: figures.discretionary, was: before?.discretionary, href: rows('discretionary'), lowerIsBetter: true },
    { key: 'invested', label: 'Invested', cents: figures.invested, was: before?.invested, href: rows('investment') },
    figures.savings > 0
      ? { key: 'savings', label: 'From savings', cents: figures.savings, was: before?.savings, lowerIsBetter: true,
          note: 'spent beyond what came in' }
      : { key: 'leftover', label: 'Left over', cents: figures.leftover, was: before?.leftover,
          note: 'came in, not spent or invested' },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((f) => {
        const delta = f.was !== undefined && f.was !== 0 ? pctChange(f.cents, f.was) : null;
        const body = <Amount cents={f.cents} />;
        return (
          <div key={f.key} className="rule-t pt-3">
            <dt className="eyebrow">{f.label}</dt>
            <dd className="mt-1.5">
              {f.href ? (
                <Link href={f.href} className="group inline-block" title={`Open the ${f.label.toLowerCase()} transactions`}>
                  <span className="decoration-rule-strong underline-offset-[6px] group-hover:underline">{body}</span>
                </Link>
              ) : body}
            </dd>
            <dd className="mt-1 min-h-[1rem] text-xs text-ink-faint">
              {delta !== null && previousLabel ? (
                <span title={improved(delta, f.lowerIsBetter) ? 'Better than before' : 'Worse than before'}>
                  <span className="figure text-ink-dim">
                    {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta).toFixed(1)}%
                  </span>{' '}
                  from <span className="figure">{formatCents(f.was!, { cents: false })}</span> in {previousLabel}
                </span>
              ) : f.note}
            </dd>
            {delta !== null && previousLabel && f.note && <dd className="text-xs text-ink-faint">{f.note}</dd>}
          </div>
        );
      })}
    </dl>
  );
}

function improved(delta: number, lowerIsBetter?: boolean) {
  return lowerIsBetter ? delta < 0 : delta > 0;
}

function shape(m: FlowModel | null) {
  const source = (k: string) => m?.sources.find((s) => s.key === k)?.cents ?? 0;
  const bucket = (k: string) => m?.buckets.find((b) => b.key === k)?.cents ?? 0;
  return {
    income: source('income'),
    savings: source('savings'),
    required: bucket('required'),
    discretionary: bucket('discretionary'),
    invested: bucket('invested'),
    leftover: bucket('leftover'),
  };
}

/** Dollars at full size, cents a step down: the cents are there, not shouted. */
export function Amount({ cents, className }: { cents: number; className?: string }) {
  const text = formatCents(cents);
  const dot = text.lastIndexOf('.');
  return (
    <span className={clsx('figure text-ink', className)}>
      <span className="text-[1.75rem] font-medium leading-none tracking-tight">{text.slice(0, dot)}</span>
      <span className="text-base text-ink-faint">{text.slice(dot)}</span>
    </span>
  );
}
