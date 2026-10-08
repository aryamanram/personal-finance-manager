import { getReviewQueue, getReviewCounts, getCategories, getGroupSlots, getActiveMonths, getLedgerBounds } from '@/lib/queries';
import { buildPeriods } from '@/lib/periods';
import { PeriodPicker } from '@/components/PeriodPicker';
import { ReviewInbox } from '@/components/ReviewInbox';

export const dynamic = 'force-dynamic';

/**
 * Review: every guess no human has confirmed, and every row nobody has filed.
 *
 * It opens on everything outstanding, whatever period the other pages are
 * on, because the nav's badge counts everything outstanding and a count must
 * be what its destination shows (V3, V5). The picker narrows it.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.period) ? params.period[0] : params.period;

  const [activeMonths, bounds] = await Promise.all([getActiveMonths(), getLedgerBounds()]);
  const periods = bounds && activeMonths.length > 0 ? buildPeriods(activeMonths, bounds) : [];
  const period = periods.find((p) => p.key === requested) ?? periods[0];
  const range = period && period.key !== 'all' ? { from: period.from, to: period.to } : {};

  const [rows, counts, categories, groupSlots] = await Promise.all([
    getReviewQueue(range),
    getReviewCounts(range),
    getCategories(),
    getGroupSlots(),
  ]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Review</div>
          {period ? <PeriodPicker options={periods} active={period.key} /> : <h1 className="text-2xl font-semibold">Review</h1>}
        </div>
        <p className="max-w-md text-xs leading-relaxed text-ink-faint">
          <span className="figure text-ink">{counts.needs_review}</span> guessed by a rule or by history
          and not yet confirmed
          {counts.uncategorized > 0 && (
            <>, and <span className="figure text-ink">{counts.uncategorized}</span> with no category at all</>
          )}
          .
        </p>
      </header>

      <ReviewInbox rows={rows} categories={categories} groupSlots={groupSlots} />
    </div>
  );
}
