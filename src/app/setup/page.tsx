import { getAccounts, getInvestmentPerformance, getIncomeSources, getCategories } from '@/lib/queries';
import { CsvImport } from '@/components/CsvImport';
import { BalanceSnapshotForm } from '@/components/BalanceSnapshotForm';
import { IncomeSources } from '@/components/IncomeSources';
import { Figure } from '@/components/Figure';

export const dynamic = 'force-dynamic';

/**
 * Bookkeeping: what the ledger needs from a person that no feed sends.
 * Moved out of Accounts, which is for looking, so that page reads as a
 * statement and this one as a set of jobs.
 */
export default async function SetupPage() {
  const [accounts, performance, incomeSources, categories] = await Promise.all([
    getAccounts(),
    getInvestmentPerformance(),
    getIncomeSources(),
    getCategories(),
  ]);
  const investments = accounts.filter((a) => a.type === 'investment');

  return (
    <div className="space-y-14">
      <header>
        <div className="eyebrow">Setup</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">What the feeds cannot send</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-dim">
          A brokerage balance once a month, a statement the bank feed cannot reach,
          and who pays you — so a deposit is filed as known income, not guessed.
        </p>
      </header>

      <section aria-labelledby="balances-heading">
        <div className="rule-b pb-2">
          <h2 id="balances-heading" className="eyebrow">Record a balance</h2>
        </div>
        {investments.length === 0 && (
          <p className="mt-4 text-sm text-ink-faint">No investment accounts to record.</p>
        )}
        <div className="mt-2 grid gap-x-12 md:grid-cols-2">
          {investments.map((a) => {
            const p = performance.find((x) => x.account_id === a.id);
            return (
              <div key={a.id} className="mt-4">
                <h3 className="text-sm font-medium text-ink">{a.name}</h3>
                <p className="mt-1 text-xs text-ink-faint">
                  {p ? (
                    <>Last recorded <Figure cents={p.current_cents} tone="neutral" showCents={false} /> on {p.as_of}</>
                  ) : 'Nothing recorded yet. The first balance is where performance starts.'}
                </p>
                <div className="mt-3 max-w-lg">
                  <BalanceSnapshotForm accountId={a.id} accountName={a.name} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <CsvImport accounts={accounts} />
      </section>

      <section aria-labelledby="income-heading">
        <div className="rule-b pb-2">
          <h2 id="income-heading" className="eyebrow">Income sources</h2>
        </div>
        <IncomeSources sources={incomeSources} categories={categories} />
      </section>
    </div>
  );
}
