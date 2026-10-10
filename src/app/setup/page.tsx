import { getAccounts, getInvestmentPerformance, getIncomeSources, getCategories } from '@/lib/queries';
import { CsvImport } from '@/components/CsvImport';
import { BalanceSnapshotForm } from '@/components/BalanceSnapshotForm';
import { IncomeSources } from '@/components/IncomeSources';
import { Figure } from '@/components/Figure';
import { Card } from '@/components/Card';

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
    <div className="space-y-6">
      <header>
        <div className="eyebrow">Setup</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">What the feeds cannot send</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-dim">
          A brokerage balance once a month, a statement the bank feed cannot reach,
          and who pays you — so a deposit is filed as known income, not guessed.
        </p>
      </header>

      <Card label="Record a balance" id="balances">
        {investments.length === 0 && (
          <p className="text-sm text-ink-faint">No investment accounts to record.</p>
        )}
        <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
          {investments.map((a) => {
            const p = performance.find((x) => x.account_id === a.id);
            return (
              <div key={a.id}>
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
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <CsvImport accounts={accounts} />
        <Card label="Income sources" id="income">
          <IncomeSources sources={incomeSources} categories={categories} />
        </Card>
      </div>
    </div>
  );
}
