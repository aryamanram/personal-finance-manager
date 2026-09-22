import {
  getTransactions, countTransactions, getCategories, getAccounts,
  getReviewCounts, getCategoryUsage,
} from '@/lib/queries';
import { TransactionTable } from '@/components/TransactionTable';
import { FilterChips } from '@/components/FilterChips';

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

  const filters = {
    from: one('from'),
    to: one('to'),
    accountIds: one('account') ? [one('account')!] : undefined,
    categoryIds: one('category') ? [one('category')!] : undefined,
    search: one('q'),
    uncategorizedOnly: one('uncategorized') === '1',
    needsReviewOnly: one('review') === '1',
    includeVoided: one('voided') === '1',
    limit: 300,
  };

  const [transactions, total, categories, accounts, review, usage] = await Promise.all([
    getTransactions(filters),
    countTransactions(filters),
    getCategories(),
    getAccounts(),
    getReviewCounts(),
    getCategoryUsage(),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Register</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              <span className="figure">{total.toLocaleString('en-US')}</span>{' '}
              {total === 1 ? 'transaction' : 'transactions'}
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-paper-faint">
              Renamed rows keep the bank’s original underneath.
              {review.needs_review > 0 && (
                <>
                  {' '}
                  <span className="figure text-paper-dim">{review.needs_review}</span>
                  {' '}still carry a machine guess.
                </>
              )}
            </p>
          </div>

          <form className="flex flex-wrap items-center gap-2 text-xs">
            {/* Preserve the chip filters while searching — dropping them made
                the search box silently widen the result set. */}
            {passthrough(params, ['uncategorized', 'review', 'voided', 'from', 'to', 'category'])}
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
            <button
              type="submit"
              className="rounded-sm border border-ink-500 px-3 py-1.5 text-paper transition-colors hover:border-paper-faint"
            >
              Apply
            </button>
          </form>
        </div>

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
        usage={Object.fromEntries(usage)}
        accounts={accounts}
        total={total}
      />
    </div>
  );
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
