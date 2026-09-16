import { getAccounts, getNetWorth, getInvestmentPerformance, getLastSync } from '@/lib/queries';
import { Figure } from '@/components/Figure';
import { CsvImport } from '@/components/CsvImport';
import { BalanceSnapshotForm } from '@/components/BalanceSnapshotForm';
import { formatCents } from '@/money';
import { formatTimestampLong } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const [accounts, netWorth, performance, lastSync] = await Promise.all([
    getAccounts(),
    getNetWorth(),
    getInvestmentPerformance(),
    getLastSync(),
  ]);

  const total = netWorth.reduce((a, n) => a + n.balance_cents, 0);

  return (
    <div className="space-y-12">
      <header>
        <div className="eyebrow">Accounts</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          <Figure cents={total} tone="neutral" showCents={false} className="text-2xl" />
          <span className="ml-3 text-sm font-normal text-paper-faint">net worth</span>
        </h1>
      </header>

      <section>
        <div className="rule-b pb-2">
          <h2 className="eyebrow">Balances</h2>
        </div>
        <table className="w-full">
          <tbody>
            {netWorth.map((n) => (
              <tr key={n.account_id} className="rule-b">
                <td className="py-3 text-sm">{n.name}</td>
                <td className="py-3 text-xs text-paper-faint">{n.type}</td>
                <td className="py-3 text-xs text-paper-faint">
                  {n.basis === 'snapshot'
                    ? `snapshot · ${n.snapshot_date}`
                    : 'from transactions'}
                </td>
                <td className="py-3 text-right">
                  <Figure cents={n.balance_cents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lastSync && (
          <p className="mt-3 text-xs text-paper-faint">
            Last sync {lastSync.finished_at
              ? formatTimestampLong(lastSync.finished_at)
              : 'in progress'}{' '}
            · {lastSync.status}
            {lastSync.error && <span className="ml-2 text-edited">{lastSync.error}</span>}
          </p>
        )}
      </section>

      {performance.map((p) => {
        // One snapshot is a starting line, not a period. Reporting 0.00% would
        // be technically true and actively misleading, so say what is actually
        // the case: tracking has begun, measurement starts at the next reading.
        const singleSnapshot = p.opening_date === p.as_of;
        return (
        <section key={p.account_id}>
          <div className="rule-b pb-2">
            <h2 className="eyebrow">{p.name}</h2>
          </div>

          {singleSnapshot && (
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-paper-dim">
              Tracking starts here, at{' '}
              <Figure cents={p.current_cents} tone="neutral" showCents={false} />{' '}
              on {p.as_of}. Whatever this account earned before today belongs to
              the past, not to a return this ledger can claim — record next
              month&rsquo;s balance and performance begins from this line.
            </p>
          )}

          {/* DESIGN.md §13: growth is measured from the first snapshot, never
              from zero, and contributions are not performance. */}
          <table className="mt-4 w-full max-w-lg">
            <tbody>
              <Line label="Sent to investment" cents={p.contributed_cents}
                    hint={singleSnapshot ? 'since tracking began' : 'linked contributions'} />
              <Line
                label="Starting position"
                cents={p.opening_cents}
                hint={`first snapshot · ${p.opening_date}`}
              />
              <Line label="Worth now" cents={p.current_cents} hint={p.as_of} />
              {!singleSnapshot && (
                <>
                  <tr className="rule-t">
                    <td className="py-3 text-sm">Market gain</td>
                    <td className="py-3 text-right">
                      <Figure
                        cents={p.gain_cents}
                        tone={p.gain_cents >= 0 ? 'in' : 'out'}
                        signed
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="pb-3 text-sm">
                      Return
                      <span className="ml-2 text-xs text-paper-faint">Modified Dietz</span>
                    </td>
                    <td className="pb-3 text-right">
                      <span
                        className={`figure text-sm ${
                          (p.return_pct ?? 0) >= 0 ? 'text-in' : 'text-out'
                        }`}
                      >
                        {p.return_pct === null ? '—' : `${p.return_pct.toFixed(2)}%`}
                      </span>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>

          {!singleSnapshot && (
            <p className="mt-3 max-w-lg text-xs leading-relaxed text-paper-faint">
              Money in the account before tracking began is a starting position, not a gain.
              A naive {'(end − start) / start'} would read{' '}
              {p.opening_cents > 0
                ? `${(((p.current_cents - p.opening_cents) / p.opening_cents) * 100).toFixed(2)}%`
                : '—'}{' '}
              here by counting the {formatCents(p.contributed_cents, { cents: false })} you
              deposited as investment return.
            </p>
          )}

          <div className="mt-6 max-w-lg">
            <BalanceSnapshotForm accountId={p.account_id} />
          </div>
        </section>
        );
      })}

      {/* An investment account with no snapshots yet has no performance row. */}
      {accounts
        .filter((a) => a.type === 'investment' && !performance.some((p) => p.account_id === a.id))
        .map((a) => (
          <section key={a.id}>
            <div className="rule-b pb-2">
              <h2 className="eyebrow">{a.name}</h2>
            </div>
            <p className="mt-3 text-sm text-paper-dim">
              No balance recorded yet. Add one to start tracking performance.
            </p>
            <div className="mt-4 max-w-lg">
              <BalanceSnapshotForm accountId={a.id} />
            </div>
          </section>
        ))}

      <section>
        <CsvImport accounts={accounts} />
      </section>
    </div>
  );
}

function Line({ label, cents, hint }: { label: string; cents: number; hint?: string }) {
  return (
    <tr className="rule-b">
      <td className="py-3 text-sm">
        {label}
        {hint && <span className="ml-2 text-xs text-paper-faint">{hint}</span>}
      </td>
      <td className="py-3 text-right">
        <Figure cents={cents} tone="neutral" />
      </td>
    </tr>
  );
}
