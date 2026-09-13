import Link from 'next/link';
import { getTransactions, countTransactions, getCategories, getAccounts } from '@/lib/queries';
import { TransactionTable } from '@/components/TransactionTable';

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
    includeVoided: one('voided') === '1',
    limit: 300,
  };

  const [transactions, total, categories, accounts] = await Promise.all([
    getTransactions(filters),
    countTransactions(filters),
    getCategories(),
    getAccounts(),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Register</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Transactions</h1>
        </div>

        <form className="flex flex-wrap items-center gap-2 text-xs">
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
          <label className="flex items-center gap-1.5 text-paper-dim">
            <input
              type="checkbox"
              name="uncategorized"
              value="1"
              defaultChecked={filters.uncategorizedOnly}
              className="accent-edited"
            />
            Uncategorized
          </label>
          <label className="flex items-center gap-1.5 text-paper-dim">
            <input
              type="checkbox"
              name="voided"
              value="1"
              defaultChecked={filters.includeVoided}
              className="accent-edited"
            />
            Show voided
          </label>
          <button
            type="submit"
            className="rounded-sm border border-ink-500 px-3 py-1.5 text-paper transition-colors hover:border-paper-faint"
          >
            Apply
          </button>
          {Object.keys(params).length > 0 && (
            <Link href="/transactions" className="px-2 py-1.5 text-paper-faint hover:text-paper">
              Reset
            </Link>
          )}
        </form>
      </header>

      <TransactionTable
        initial={transactions}
        categories={categories}
        accounts={accounts}
        total={total}
      />
    </div>
  );
}
