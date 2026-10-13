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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((f) => {
        const delta = f.was !== undefined && f.was !== 0 ? pctChange(f.cents, f.was) : null;
        // The label comes first for a screen reader; the number first by eye.
        const body = (
          <dl className="flex flex-col items-center">
            <dt className="eyebrow order-2 mt-2">{f.label}</dt>
            <dd className="order-1"><Amount cents={f.cents} /></dd>
            <dd className="order-3 mt-2 min-h-[2rem] text-xs leading-snug text-ink-faint">
              {delta !== null && previousLabel ? (
                <span className="block" title={improved(delta, f.lowerIsBetter) ? 'Better than before' : 'Worse than before'}>
                  <span className="figure-display font-medium text-ink-dim">
                    {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta).toFixed(1)}%
                  </span>{' '}
                  from <span className="figure-display">{formatCents(f.was!, { cents: false })}</span> in {previousLabel}
                </span>
              ) : null}
              {f.note && <span className="block">{f.note}</span>}
            </dd>
          </dl>
        );
        // The whole card opens the rows, so the target is the size of the figure.
        return f.href ? (
          <Link
            key={f.key}
            href={f.href}
            title={`Open the ${f.label.toLowerCase()} transactions`}
            className="card block px-4 py-5 text-center transition-transform duration-150 hover:-translate-y-0.5"
          >
            {body}
          </Link>
        ) : (
          <div key={f.key} className="card px-4 py-5 text-center">{body}</div>
        );
      })}
    </div>
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
    <span className={clsx('figure-display text-ink', className)}>
      <span className="text-[1.65rem] font-semibold leading-none tracking-tight">{text.slice(0, dot)}</span>
      <span className="text-base font-medium text-ink-faint">{text.slice(dot)}</span>
    </span>
  );
}
