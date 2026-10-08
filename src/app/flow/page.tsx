import Link from 'next/link';
import { getCashflow, getFlow, getLedgerBounds, getActiveMonths } from '@/lib/queries';
import { PeriodPicker } from '@/components/PeriodPicker';
import { buildPeriods } from '@/lib/periods';
import { resolvePeriod } from '@/lib/resolve-period';
import { Sankey } from '@/components/Sankey';
import { FlowDrilldown } from '@/components/FlowDrilldown';

export const dynamic = 'force-dynamic';

/**
 * The diagram, full width, with what sits under each band (wireframe 43:2).
 *
 * Split out of the dashboard so both have room: the Sankey was competing with
 * the stat cards for the same screen, and neither won.
 */
export default async function FlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.period) ? params.period[0] : params.period;

  const [cashflow, activeMonths, bounds] = await Promise.all([
    getCashflow(24),
    getActiveMonths(),
    getLedgerBounds(),
  ]);
  if (!bounds || activeMonths.length === 0) return <EmptyState />;

  const periods = buildPeriods(activeMonths, bounds);
  const period = resolvePeriod(periods, cashflow, requested);

  // One query for the diagram and the list beneath it, so they cannot
  // disagree: gross categories, credits counted once as their own source.
  const flow = await getFlow(period.from, period.to);

  return (
    <div className="space-y-10">
      {/* The picker carries the heading: the timeframe IS the title. */}
      <header>
        <div className="eyebrow mb-1">Flow</div>
        <PeriodPicker options={periods} active={period.key} />
      </header>

      <section>
        <Sankey data={flow} />
      </section>

      <FlowDrilldown breakdown={flow.categories} from={period.from} to={period.to} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rule-t mx-auto mt-24 max-w-md pt-8 text-center">
      <h1 className="text-lg font-medium">Nothing to diagram yet</h1>
      <p className="mt-3 text-sm leading-relaxed text-paper-dim">
        The flow diagram needs a month of transactions to draw.
      </p>
      <div className="mt-6 flex justify-center gap-6 text-sm">
        <Link
          href="/transactions"
          className="border-b border-paper-faint pb-0.5 text-paper hover:border-paper"
        >
          Import a statement
        </Link>
        <code className="figure text-xs text-paper-faint">npm run sync</code>
      </div>
    </div>
  );
}
