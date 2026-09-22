import Link from 'next/link';
import {
  getCashflow, getCategoryBreakdownRange, getPeriodTotals, getUncategorizedCount,
  getLastSync, getReconciliation, getLedgerBounds, getActiveMonths,
} from '@/lib/queries';
import { PeriodPicker } from '@/components/PeriodPicker';
import { buildPeriods, describePeriod } from '@/lib/periods';
import { resolvePeriod } from '@/lib/resolve-period';
import { StatCard } from '@/components/StatCard';
import { CostMixChart } from '@/components/CostMixChart';
import { CategoryRows } from '@/components/CategoryRows';
import { Figure } from '@/components/Figure';
import { formatCents } from '@/money';
import { formatTimestampShort } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

/** Renders cashflow metrics and charts for the selected ledger period. */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.period) ? params.period[0] : params.period;

  // The chart wants a bounded window; the period picker wants every month the
  // ledger has. Sharing one query meant a year older than 24 months never
  // appeared as an option even though all-time already covered it.
  const [cashflow, activeMonths, bounds] = await Promise.all([
    getCashflow(24),
    getActiveMonths(),
    getLedgerBounds(),
  ]);
  if (!bounds || activeMonths.length === 0) return <EmptyState />;

  const periods = buildPeriods(activeMonths, bounds);
  const period = resolvePeriod(periods, cashflow, requested);

  const [totals, breakdown, uncategorized, lastSync, drift] = await Promise.all([
    getPeriodTotals(period.from, period.to),
    getCategoryBreakdownRange(period.from, period.to),
    getUncategorizedCount(),
    getLastSync(),
    getReconciliation(),
  ]);

  // Month-over-month deltas only mean something for a single whole month —
  // not for a year, and not for half of one.
  const isMonth = period.scope === 'month';
  const idx = cashflow.findIndex((m) => m.month.startsWith(period.key));
  const previous = isMonth && idx > 0 ? cashflow[idx - 1] : undefined;

  const heading = describePeriod(period);

  const income = totals.income_cents;
  const required = totals.required_cents;
  const discretionary = totals.discretionary_cents;
  const invested = totals.invested_cents;
  const spendable = income - required;

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Cashflow</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {heading}
          </h1>
          <div className="mt-3">
            <PeriodPicker options={periods} active={period.key} align="start" />
          </div>
        </div>
        <div className="flex items-center gap-6 text-xs text-paper-faint">
          {lastSync?.finished_at && (
            <span>
              Last sync{' '}
              <span className="figure text-paper-dim">
                {formatTimestampShort(lastSync.finished_at)}
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
        <div className="rule-b pb-2">
          {/* Name the span the data actually covers, not the span requested. */}
          <h2 className="eyebrow">
            Fixed vs variable · last {Math.min(cashflow.length, 12)} months
          </h2>
        </div>
        <p className="mt-2 mb-6 max-w-lg text-xs leading-relaxed text-paper-faint">
          Fixed costs are the part of next month you already know. The taller
          the dark band, the more predictable the month.
        </p>
        <CostMixChart data={cashflow.slice(-12)} />
      </section>

      <section>
        <div className="rule-b flex flex-wrap items-baseline justify-between gap-2 pb-2">
          <h2 className="eyebrow">Where it went</h2>
          <span className="text-xs text-paper-faint">
            Invested{' '}
            <Figure cents={invested} tone="invest" showCents={false} />
            {' · '}
            <Link href="/flow" className="transition-colors hover:text-paper">
              see the flow →
            </Link>
          </span>
        </div>
        <div className="mt-2">
          <CategoryRows rows={breakdown} from={period.from} to={period.to} />
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
