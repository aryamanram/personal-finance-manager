import Link from 'next/link';
import {
  getCashflow, getFlow, getGroupSlots, getCategoryFlow, getLastSync, getReconciliation,
  getLedgerBounds, getActiveMonths, getCardSettlement,
} from '@/lib/queries';
import { PeriodPicker } from '@/components/PeriodPicker';
import { buildPeriods, describePeriod, stepPeriod, type PeriodOption } from '@/lib/periods';
import { resolvePeriod } from '@/lib/resolve-period';
import { buildFlow, buildCategoryFlow, insideOptions, defaultInside } from '@/lib/flow';
import { MonthFigures } from '@/components/MonthFigures';
import { FlowView } from '@/components/FlowView';
import { CategoryInside } from '@/components/CategoryInside';
import { CostMixChart } from '@/components/CostMixChart';
import { formatCents } from '@/money';
import { formatTimestampShort } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

/**
 * The Flow: the first page, because "where did the money go" is the question
 * the ledger is opened to answer (docs/design/OVERHAUL.md).
 *
 * Top to bottom: the period, anything that needs attention, the period in
 * five figures, the Flow, one category's own Flow, and fixed against
 * variable. Every number on it comes from one model, so they agree.
 */
export default async function FlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  // The chart wants a bounded window; the period picker wants every month the
  // ledger has.
  const [cashflow, activeMonths, bounds] = await Promise.all([
    getCashflow(24),
    getActiveMonths(),
    getLedgerBounds(),
  ]);
  if (!bounds || activeMonths.length === 0) return <EmptyState />;

  const periods = buildPeriods(activeMonths, bounds);
  const period = resolvePeriod(periods, cashflow, one('period'));
  // The change is measured against the period before, at the same zoom. All
  // time has nothing before it.
  const previous = period.scope === 'all' ? undefined : stepPeriod(periods, period, -1);

  const [flow, before, groupSlots, lastSync, drift, cards] = await Promise.all([
    getFlow(period.from, period.to),
    previous ? getFlow(previous.from, previous.to) : null,
    getGroupSlots(),
    getLastSync(),
    getReconciliation(),
    getCardSettlement(),
  ]);
  const model = buildFlow({ ...flow, groupSlots });
  const prior = before ? buildFlow({ ...before, groupSlots }) : null;

  // Inside a category: the one in the URL if it spent this period, else the
  // largest one that splits into subcategories.
  const options = insideOptions(model);
  const chosen = options.find((o) => o.id === one('focus')) ?? defaultInside(options);
  const detail = chosen
    ? buildCategoryFlow(
        { id: chosen.id, name: chosen.name, group: chosen.group, slot: chosen.slot },
        await getCategoryFlow(chosen.id, period.from, period.to),
      )
    : null;

  const range = { from: period.from, to: period.to };
  const attention = [
    ...drift.map((d) => (
      <span key={`drift:${d.name}`}>
        {d.name} differs from the bank by <span className="figure text-ink">{formatCents(d.drift_cents)}</span>
      </span>
    )),
    ...cards.filter((c) => c.gap_cents !== 0).map((c) => (
      <span key={`card:${c.name}`}>
        {c.name} is <span className="figure text-ink">{formatCents(c.gap_cents)}</span> from what its issuer reports
      </span>
    )),
    ...(lastSync && lastSync.status !== 'ok' && lastSync.status !== 'running'
      ? [<span key="sync">The last sync {lastSync.status === 'failed' ? 'failed' : 'was partial'}</span>]
      : []),
  ];

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        {/* The picker carries the heading: the timeframe IS the title. */}
        <div>
          <div className="eyebrow mb-1">Flow</div>
          <PeriodPicker options={periods} active={period.key} align="start" />
        </div>
        {lastSync?.finished_at && (
          <p className="text-xs text-ink-faint">
            Synced <span className="figure text-ink-dim">{formatTimestampShort(lastSync.finished_at)}</span>
          </p>
        )}
      </header>

      {/* Passive, per DESIGN.md §12: a line, never a block. Only when
          something is off; the all-clear lives on Accounts. */}
      {attention.length > 0 && (
        <div role="status" className="-mt-6 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-l-2 border-alert pl-3 text-xs text-ink-dim">
          <span className="font-medium text-alert">Needs a look</span>
          {attention}
          <Link href="/accounts" className="text-ink-faint underline decoration-rule-strong underline-offset-4 hover:text-ink">
            Accounts →
          </Link>
        </div>
      )}

      <MonthFigures
        model={model}
        previous={prior}
        previousLabel={previous ? shortName(previous) : undefined}
        period={range}
      />

      <FlowView model={model} period={range} label={describePeriod(period)} />

      <CategoryInside detail={detail} options={options} period={range} />

      <section aria-labelledby="mix-heading">
        <div className="rule-b pb-2">
          {/* Name the span the data actually covers, not the span requested. */}
          <h2 id="mix-heading" className="eyebrow">
            Fixed against variable · last {Math.min(cashflow.length, 12)} months
          </h2>
        </div>
        <p className="mt-2 mb-6 max-w-lg text-xs leading-relaxed text-ink-faint">
          Fixed costs are the part of next month you already know. The taller
          the lower band, the more predictable the month.
        </p>
        <CostMixChart data={cashflow.slice(-12)} />
      </section>
    </div>
  );
}

/** "August", "2025", "the first half of August": what a change is from. */
function shortName(p: PeriodOption): string {
  if (p.scope === 'year') return p.key;
  const long = describePeriod(p);
  if (p.scope === 'month') return long.replace(/\s+\d{4}$/, '');
  return long;
}

function EmptyState() {
  return (
    <div className="rule-t mx-auto mt-24 max-w-md pt-8 text-center">
      <h1 className="text-lg font-medium">No transactions yet</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-dim">
        Import an Apple Card statement or run a SimpleFIN sync, and the Flow
        will show where the money went.
      </p>
      <div className="mt-6 flex justify-center gap-6 text-sm">
        <Link href="/accounts" className="border-b border-ink-faint pb-0.5 text-ink hover:border-ink">
          Import a statement
        </Link>
        <code className="figure text-xs text-ink-faint">npm run sync</code>
      </div>
    </div>
  );
}
