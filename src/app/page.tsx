import Link from 'next/link';
import {
  getCashflow, getCategoryBreakdown, getUncategorizedCount,
  getLastSync, getReconciliation,
} from '@/lib/queries';
import { StatCard } from '@/components/StatCard';
import { Sankey } from '@/components/Sankey';
import { CostMixChart } from '@/components/CostMixChart';
import { Figure } from '@/components/Figure';
import { formatCents } from '@/money';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const cashflow = await getCashflow(12);
  const current = cashflow[cashflow.length - 1];
  const previous = cashflow[cashflow.length - 2];

  const [breakdown, uncategorized, lastSync, drift] = await Promise.all([
    current ? getCategoryBreakdown(current.month) : Promise.resolve([]),
    getUncategorizedCount(),
    getLastSync(),
    getReconciliation(),
  ]);

  if (!current) return <EmptyState />;

  const monthLabel = new Date(`${current.month}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

  const income = current.income_cents ?? 0;
  const required = current.required_cents ?? 0;
  const discretionary = current.discretionary_cents ?? 0;
  const invested = current.invested_cents ?? 0;
  const spendable = current.spendable_cents ?? 0;

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Cashflow</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{monthLabel}</h1>
        </div>
        <div className="flex items-center gap-6 text-xs text-paper-faint">
          {lastSync?.finished_at && (
            <span>
              Last sync{' '}
              <span className="figure text-paper-dim">
                {new Date(lastSync.finished_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric',
                })}
              </span>
              {lastSync.status !== 'ok' && (
                <span className="ml-2 text-out">({lastSync.status})</span>
              )}
            </span>
          )}
          {uncategorized > 0 && (
            <Link
              href="/transactions?uncategorized=1"
              className="figure border-b border-edited pb-0.5 text-edited transition-opacity hover:opacity-80"
            >
              {uncategorized} uncategorized →
            </Link>
          )}
        </div>
      </header>

      {/* Reconciliation is passive, per DESIGN.md §12 — a banner, never a block. */}
      {drift.length > 0 && (
        <div className="rule-t border-t-edited/40 pt-3 text-xs text-paper-dim">
          <span className="text-edited">Reconciliation</span>{' '}
          {drift.map((d) => (
            <span key={d.name} className="ml-3">
              {d.name} differs from the bank by{' '}
              <span className="figure text-paper">{formatCents(d.drift_cents)}</span>
            </span>
          ))}
        </div>
      )}

      <section className="grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4">
        <StatCard label="Income" cents={income} previousCents={previous?.income_cents} tone="in" />
        <StatCard label="Required" cents={required} previousCents={previous?.required_cents} tone="out" />
        <StatCard label="Discretionary" cents={discretionary} previousCents={previous?.discretionary_cents} tone="out" />
        <StatCard
          label="Spendable"
          cents={spendable}
          previousCents={previous?.spendable_cents}
          tone="neutral"
          emphasis
          hint="income − required"
        />
      </section>

      <section>
        <div className="rule-b flex items-baseline justify-between pb-2">
          <h2 className="eyebrow">Where it went</h2>
          <span className="text-xs text-paper-faint">
            Invested this month{' '}
            <Figure cents={invested} tone="invest" showCents={false} />
          </span>
        </div>
        <div className="pt-6">
          <Sankey
            data={{
              incomeCents: income,
              requiredCents: required,
              discretionaryCents: discretionary,
              investedCents: invested,
              categories: breakdown.map((b) => ({
                name: b.category_name,
                necessity: b.necessity,
                cents: b.total_cents,
              })),
            }}
          />
        </div>
      </section>

      <section className="grid gap-10 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="rule-b pb-2">
            {/* Name the span the data actually covers, not the span requested. */}
            <h2 className="eyebrow">
              Fixed vs variable · {cashflow.length} month{cashflow.length === 1 ? '' : 's'}
            </h2>
          </div>
          <p className="mt-2 mb-4 max-w-lg text-xs leading-relaxed text-paper-faint">
            Fixed costs are the part of next month you already know. The taller
            the dark band, the more predictable the month.
          </p>
          <CostMixChart data={cashflow} />
        </div>

        <div>
          <div className="rule-b pb-2">
            <h2 className="eyebrow">Top categories</h2>
          </div>
          <ul className="mt-2">
            {breakdown.slice(0, 12).map((b) => (
              <li
                key={`${b.category_id}-${b.necessity}`}
                className="rule-b flex items-baseline justify-between gap-4 py-2 text-sm"
              >
                <Link
                  href={b.category_id ? `/categories/${b.category_id}` : '/transactions'}
                  className="truncate text-paper-dim transition-colors hover:text-paper"
                >
                  {b.category_name}
                </Link>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span
                    className="eyebrow"
                    style={{
                      color: b.necessity === 'required'
                        ? 'var(--color-out-dim)'
                        : 'var(--color-paper-faint)',
                    }}
                  >
                    {b.cost_type === 'fixed' ? 'fix' : 'var'}
                  </span>
                  <Figure cents={b.total_cents} tone="neutral" showCents={false} className="text-sm" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rule-t mx-auto mt-24 max-w-md pt-8 text-center">
      <h1 className="text-lg font-medium">No transactions yet</h1>
      <p className="mt-3 text-sm leading-relaxed text-paper-dim">
        Import an Apple Card statement or run a SimpleFIN sync to get started.
      </p>
      <div className="mt-6 flex justify-center gap-6 text-sm">
        <Link href="/transactions" className="border-b border-paper-faint pb-0.5 text-paper hover:border-paper">
          Import a statement
        </Link>
        <code className="figure text-xs text-paper-faint">npm run seed</code>
      </div>
    </div>
  );
}
