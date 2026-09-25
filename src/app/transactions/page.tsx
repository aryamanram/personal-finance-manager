import {
  getTransactions, countTransactions, getCategories, getAccounts,
  getReviewCounts, getActiveMonths, getLedgerBounds,
} from '@/lib/queries';
import { TransactionTable } from '@/components/TransactionTable';
import { FilterChips } from '@/components/FilterChips';
import { PeriodPicker } from '@/components/PeriodPicker';
import { buildPeriods } from '@/lib/periods';
import { CategoryFilter } from '@/components/CategoryFilter';
import type { CategoryWithGroup } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  // The same ?period= the dashboard and Flow use, so moving between pages
  // keeps the timeframe. The register defaults to ALL TIME rather than the
  // latest month: this page is where you go to find a transaction, and a
  // default that hides most of the ledger makes a search look like a miss.
  const [activeMonths, bounds] = await Promise.all([getActiveMonths(), getLedgerBounds()]);
  const periods = bounds && activeMonths.length > 0
    ? buildPeriods(activeMonths, bounds)
    : [];
  const requested = one('period');
  const period = periods.find((p) => p.key === requested) ?? periods[0];

  const allCategories = await getCategories();

  /**
   * Categories hidden from the register.
   *
   * The URL carries what is HIDDEN, not what is shown, because the default is
   * not "everything" — Credit Card Payment starts off. An absent param has to
   * mean the default, so encoding the shown set would make a fresh load and a
   * deliberately-empty selection look identical. `hide=none` is the explicit
   * "show everything", which an absent param cannot express.
   */
  const defaultHiddenIds = allCategories
    .filter((c) => c.name === 'Credit Card Payment')
    .map((c) => c.id);
  const hideParam = one('hide');
  const hiddenCategoryIds = resolveHidden(hideParam, allCategories, defaultHiddenIds);

  const filters = {
    // An explicit from/to still wins, so a link with a hand-built range works.
    from: one('from') ?? period?.from,
    to: one('to') ?? period?.to,
    accountIds: one('account') ? [one('account')!] : undefined,
    excludeCategoryIds: hiddenCategoryIds,
    search: one('q'),
    uncategorizedOnly: one('uncategorized') === '1',
    needsReviewOnly: one('review') === '1',
    includeVoided: one('voided') === '1',
    limit: 300,
  };

  const categories = allCategories;
  const [transactions, total, accounts, review] = await Promise.all([
    getTransactions(filters),
    countTransactions(filters),
    getAccounts(),
    // Scoped to the period, so the chip counts what the table would show.
    getReviewCounts({ from: filters.from, to: filters.to }),
  ]);

  return (
    <div className="space-y-6">
      {/* Identity and state on one line, controls on the next. The old header
          said the count three ways — an h1 "396 transactions", a sentence
          repeating the review backlog, and a chip carrying the same number —
          across 127px before the first row. */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Register</h1>
            <span className="text-xs text-paper-faint">
              <span className="figure text-paper-dim">
                {total.toLocaleString('en-US')}
              </span>{' '}
              {total === 1 ? 'transaction' : 'transactions'}
            </span>
          </div>

          <form className="flex flex-wrap items-center gap-2 text-xs">
            {/* Preserve the chip filters while searching — dropping them made
                the search box silently widen the result set. */}
            {/* 'hide' rides along: the filter navigates on its own and is
                not a field of this form, so without carrying it here applying
                a search would silently un-hide everything. */}
            {passthrough(params, [
              'uncategorized', 'review', 'voided', 'from', 'to', 'period', 'hide',
            ])}
            <input
              name="q"
              defaultValue={one('q') ?? ''}
              placeholder="Search descriptions"
              className="w-56 rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5 placeholder:text-paper-faint"
            />
            <select
              name="account"
              defaultValue={one('account') ?? ''}
              className="rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5"
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {/* Sits with the other filters, but is not a FIELD of this form:
                it navigates on pick, so there is nothing to Apply. Its trigger
                is type="button" so it never submits, and 'category' rides
                along in the passthrough above. */}
            <CategoryFilter
              categories={categories}
              hiddenIds={hiddenCategoryIds}
              defaultHiddenIds={defaultHiddenIds}
            />

            <button
              type="submit"
              className="rounded-sm border border-ink-500 px-3 py-1.5 text-paper transition-colors hover:border-paper-faint"
            >
              Apply
            </button>
          </form>
        </div>

        {period && (
          <PeriodPicker options={periods} active={period.key} />
        )}

        <FilterChips
          needsReview={review.needs_review}
          uncategorized={review.uncategorized}
          active={{
            review: one('review') === '1',
            uncategorized: one('uncategorized') === '1',
            voided: one('voided') === '1',
          }}
          hasFilters={Object.keys(params).length > 0}
        />
      </header>

      <TransactionTable
        initial={transactions}
        categories={categories}
        accounts={accounts}
        total={total}
        allCategoriesHidden={
          allCategories.length > 0 && hiddenCategoryIds.length >= allCategories.length
        }
      />
    </div>
  );
}

/**
 * Which categories the register hides, from the `hide` param.
 *
 * Four forms, because the param has to distinguish "nothing was said" from
 * "nothing is hidden", and because naming 55 uuids to hide is a worse URL than
 * naming the 3 to show:
 *
 *   absent            the default (Credit Card Payment)
 *   none              hide nothing
 *   all               hide everything
 *   only:<a>,<b>      show ONLY these
 *   <a>,<b>           hide these
 */
export function resolveHidden(
  param: string | undefined,
  categories: CategoryWithGroup[],
  fallback: string[],
): string[] {
  if (!param) return fallback;
  if (param === 'none') return [];
  if (param === 'all') return categories.map((c) => c.id);
  if (param.startsWith('only:')) {
    const shown = new Set(param.slice('only:'.length).split(',').filter(Boolean));
    return categories.filter((c) => !shown.has(c.id)).map((c) => c.id);
  }
  return param.split(',').filter(Boolean);
}

/** Re-emits the chip filters as hidden inputs so the search form keeps them. */
function passthrough(
  params: Record<string, string | string[] | undefined>,
  keys: string[],
) {
  return keys.map((k) => {
    const v = params[k];
    const value = Array.isArray(v) ? v[0] : v;
    if (!value) return null;
    return <input key={k} type="hidden" name={k} value={value} />;
  });
}
