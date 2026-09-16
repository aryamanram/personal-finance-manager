import Link from 'next/link';
import {
  getCashflow, getCategoryBreakdownRange, getPeriodTotals, getUncategorizedCount,
  getLastSync, getReconciliation, getLedgerBounds, getActiveMonths,
} from '@/lib/queries';
import { PeriodPicker } from '@/components/PeriodPicker';
import { buildPeriods } from '@/lib/periods';
import { StatCard } from '@/components/StatCard';
import { Sankey } from '@/components/Sankey';
import { CostMixChart } from '@/components/CostMixChart';
import { Figure } from '@/components/Figure';
import { formatCents } from '@/money';
import { formatMonthLong, formatTimestampShort } from '@/lib/format-date';

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
  // Default to the most recent month that actually had money moving, rather
  // than the current calendar month — which, part-way through, or in a month
  // with no income, has nothing worth charting.
  const fallback =
    periods.find((p) => {
      const row = cashflow.find((m) => m.month.startsWith(p.key));
      // Any movement counts. Testing income and discretionary only meant a
      // month of nothing but rent opened an older period instead.
      return row && [
        row.income_cents, row.required_cents,
        row.discretionary_cents, row.invested_cents,
      ].some((cents) => (cents ?? 0) > 0);
    }) ?? periods[0];
  const period = periods.find((p) => p.key === requested) ?? fallback;

  const [totals, breakdown, uncategorized, lastSync, drift] = await Promise.all([
    getPeriodTotals(period.from, period.to),
    getCategoryBreakdownRange(period.from, period.to),
    getUncategorizedCount(),
    getLastSync(),
    getReconciliation(),
  ]);

  // Month-over-month deltas only mean something for a single month.
  const isMonth = /^\d{4}-\d{2}$/.test(period.key);
  const idx = cashflow.findIndex((m) => m.month.startsWith(period.key));
  const previous = isMonth && idx > 0 ? cashflow[idx - 1] : undefined;

  // A yearly or all-time period has no month to name — formatting its `from`
  // date rendered the year 2026 as "Jan 26".
  const monthLabel = isMonth ? formatMonthLong(period.from) : period.label;

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
            {period.key === 'all' ? 'All time' : monthLabel}
          </h1>
          <div className="mt-3">
            <PeriodPicker options={periods} active={period.key} />
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
        <div className="rule-b flex items-baseline justify-between pb-2">
          <h2 className="eyebrow">Where it went</h2>
          <span className="text-xs text-paper-faint">
            Invested{' '}
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
              Fixed vs variable · last {Math.min(cashflow.length, 12)} months
            </h2>
          </div>
          <p className="mt-2 mb-4 max-w-lg text-xs leading-relaxed text-paper-faint">
            Fixed costs are the part of next month you already know. The taller
            the dark band, the more predictable the month.
          </p>
          <CostMixChart data={cashflow.slice(-12)} />
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
