import {
  getTransactions, countTransactions, getCategories, getAccounts,
  getReviewCounts, getActiveMonths, getLedgerBounds, getTransactionTotals, getGroupSlots,
} from '@/lib/queries';
import { TransactionTable } from '@/components/TransactionTable';
import { FilterChips } from '@/components/FilterChips';
import { PeriodPicker } from '@/components/PeriodPicker';
import { buildPeriods } from '@/lib/periods';
import { CategoryFilter } from '@/components/CategoryFilter';
import { registerView } from '@/lib/register-filters';

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
  // A link from a figure names its dates; when they are exactly a period,
  // the picker says which, rather than "All time" over one month's rows.
  // Periods are clamped to the ledger, so the dates are too before comparing:
  // September 1st-30th is September in a ledger that ends on the 28th.
  const clamp = (d: string | undefined, edge: 'first' | 'last') => {
    if (!d || !bounds) return d;
    return edge === 'first' ? (d < bounds.first ? bounds.first : d) : (d > bounds.last ? bounds.last : d);
  };
  const dated = one('from') || one('to')
    ? periods.find((p) => p.from === clamp(one('from'), 'first') && p.to === clamp(one('to'), 'last'))
    : undefined;
  const period = dated ?? periods.find((p) => p.key === requested) ?? periods[0];
  const customRange = !dated && (one('from') || one('to'));

  const allCategories = await getCategories();

  // Read by the same function the tests open the Flow's links with (V2).
  // `category` and `necessity` arrive from a figure (registerHref): exactly
  // that category's rows — with its subcategories when `sub=1` — and its
  // necessity when the figure was one bucket's share of a category.
  const {
    filters: view, linkedCategory, withSubcategories, linkedNecessity,
    hiddenCategoryIds, defaultHiddenIds,
  } = registerView(one, allCategories, period);
  const filters = { ...view, limit: 300 };

  const categories = allCategories;
  const [transactions, total, totals, accounts, review, groupSlots] = await Promise.all([
    getTransactions(filters),
    countTransactions(filters),
    // Over every matching row, not the 300 loaded — and gross, so a figure
    // clicked in the Flow lands on the same number here.
    getTransactionTotals(filters),
    getAccounts(),
    // Under the table's own filters, so each chip counts what it would show (V3).
    getReviewCounts(filters),
    getGroupSlots(),
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
            <span className="text-xs text-ink-faint">
              <span className="figure text-ink-dim">
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
              'category', 'necessity', 'sub', 'merchant', 'credits',
            ])}
            <input
              name="q"
              defaultValue={one('q') ?? ''}
              placeholder="Search descriptions"
              className="w-56 rounded-sm border border-rule-strong bg-well px-2 py-1.5 placeholder:text-ink-faint"
            />
            <select
              name="account"
              aria-label="Account"
              defaultValue={one('account') ?? ''}
              className="rounded-sm border border-rule-strong bg-well px-2 py-1.5"
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
              className="rounded-sm border border-ink-faint px-3 py-1.5 text-ink transition-colors hover:border-ink-faint"
            >
              Apply
            </button>
          </form>
        </div>

        {customRange ? (
          <p className="text-sm text-ink-dim">
            <span className="figure text-ink">{one('from') ?? 'the start'}</span> to{' '}
            <span className="figure text-ink">{one('to') ?? 'today'}</span>
            {' · '}
            <a href={withoutParams(params, ['from', 'to'])} className="text-xs text-ink-faint underline decoration-rule-strong underline-offset-4 hover:text-ink">
              any date
            </a>
          </p>
        ) : period && (
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

        {/* Said out loud, because the category filter's own control cannot
            express "this one category" and the page would otherwise be
            silently narrower than it looks. */}
        {linkedCategory && (
          <p className="text-xs text-ink-faint">
            Only <span className="text-ink">{linkedCategory.name}</span>
            {withSubcategories && <> and its subcategories</>}
            {linkedNecessity && <> · {linkedNecessity}</>}
            {' · '}
            <a href={withoutParams(params, ['category', 'necessity', 'sub'])} className="underline decoration-ink-faint underline-offset-4 hover:text-ink">
              show every category
            </a>
          </p>
        )}
      </header>

      <TransactionTable
        initial={transactions}
        categories={categories}
        accounts={accounts}
        total={total}
        totals={totals}
        groupSlots={groupSlots}
        allCategoriesHidden={
          allCategories.length > 0 && hiddenCategoryIds.length >= allCategories.length
        }
      />
    </div>
  );
}

/** This page's URL with some parameters dropped. */
function withoutParams(params: Record<string, string | string[] | undefined>, drop: string[]): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (drop.includes(k) || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) p.append(k, one);
  }
  const q = p.toString();
  return q ? `/transactions?${q}` : '/transactions';
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
