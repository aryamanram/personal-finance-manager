import Link from 'next/link';
import {
  getAccounts, getNetWorth, getInvestmentPerformance, getLastSync, getReconciliation, getCardSettlement,
  type CardSettlement,
} from '@/lib/queries';
import { Figure } from '@/components/Figure';
import { formatCents } from '@/money';
import { formatTimestampLong } from '@/lib/format-date';
import { Card } from '@/components/Card';

export const dynamic = 'force-dynamic';

/**
 * Balances, net worth and investment returns, and the two standing checks
 * that the ledger matches the banks. Viewing only: recording a balance, an
 * import and income sources are on Setup.
 */
export default async function AccountsPage() {
  const [accounts, netWorth, performance, lastSync, drift, cards] = await Promise.all([
    getAccounts(),
    getNetWorth(),
    getInvestmentPerformance(),
    getLastSync(),
    getReconciliation(),
    getCardSettlement(),
  ]);

  const total = netWorth.reduce((a, n) => a + n.balance_cents, 0);

  return (
    <div className="space-y-6">
      <header>
        <div className="eyebrow">Accounts</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          <Figure cents={total} tone="neutral" showCents={false} className="text-2xl" />
          <span className="ml-3 text-sm font-normal text-ink-faint">net worth</span>
        </h1>
      </header>

      {/* Two columns once there is room for a table in each; one below that. */}
      <div className="grid items-start gap-5 xl:grid-cols-2">
      <Card label="Balances">
        <table className="w-full">
          <tbody className="divide-y divide-rule">
            {netWorth.map((n) => (
              <tr key={n.account_id}>
                <td className="py-3 text-sm">{n.name}</td>
                <td className="py-3 text-xs text-ink-faint">{n.type}</td>
                <td className="py-3 text-xs text-ink-faint">
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
          <p className="mt-3 text-xs text-ink-faint">
            Last sync {lastSync.finished_at
              ? formatTimestampLong(lastSync.finished_at)
              : 'in progress'}{' '}
            · {lastSync.status}
            {lastSync.error && <span className="ml-2 text-alert">{lastSync.error}</span>}
          </p>
        )}
      </Card>

      <Card label="Does the ledger match the banks?" id="checks">
        <ul className="-mt-2 divide-y divide-rule">
          <Check ok={drift.length === 0} name="Balances">
            {drift.length === 0
              ? 'every account adds up to the balance its bank reports'
              : drift.map((d) => (
                <span key={d.name} className="mr-4">
                  {d.name} differs from the bank by <span className="figure text-ink">{formatCents(d.drift_cents)}</span>
                </span>
              ))}
          </Check>
          <CardsCheck cards={cards} />
        </ul>
      </Card>

      {performance.map((p) => {
        // One snapshot is a starting line, not a period. Reporting 0.00% would
        // be technically true and actively misleading, so say what is actually
        // the case: tracking has begun, measurement starts at the next reading.
        const singleSnapshot = p.opening_date === p.as_of;
        return (
        <Card key={p.account_id} label={p.name} id={`investment-${p.account_id}`}>
          {singleSnapshot && (
            <p className="max-w-lg text-sm leading-relaxed text-ink-dim">
              Tracking starts here, at{' '}
              <Figure cents={p.current_cents} tone="neutral" showCents={false} />{' '}
              on {p.as_of}. Whatever this account earned before today belongs to
              the past, not to a return this ledger can claim — record next
              month&rsquo;s balance and performance begins from this line.
            </p>
          )}

          {/* DESIGN.md §13: growth is measured from the first snapshot, never
              from zero, and contributions are not performance. */}
          <table className={singleSnapshot ? 'mt-4 w-full' : 'w-full'}>
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
                      <span className="ml-2 text-xs text-ink-faint">Modified Dietz</span>
                    </td>
                    <td className="pb-3 text-right">
                      <span
                        className={`figure text-sm ${
                          (p.return_pct ?? 0) >= 0 ? 'text-earned' : 'text-ink'
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
            <p className="mt-3 max-w-lg text-xs leading-relaxed text-ink-faint">
              Money in the account before tracking began is a starting position, not a gain.
              A naive {'(end − start) / start'} would read{' '}
              {p.opening_cents > 0
                ? `${(((p.current_cents - p.opening_cents) / p.opening_cents) * 100).toFixed(2)}%`
                : '—'}{' '}
              here by counting the {formatCents(p.contributed_cents, { cents: false })} you
              deposited as investment return.
            </p>
          )}

          <p className="mt-4 text-xs text-ink-faint">
            <Link href="/setup" className="underline decoration-rule-strong underline-offset-4 hover:text-ink">
              Record this month&rsquo;s balance in Setup →
            </Link>
          </p>
        </Card>
        );
      })}

      {/* An investment account with no snapshots yet has no performance row. */}
      {accounts
        .filter((a) => a.type === 'investment' && !performance.some((p) => p.account_id === a.id))
        .map((a) => (
          <Card key={a.id} label={a.name} id={`investment-${a.id}`}>
            <p className="text-sm text-ink-dim">
              No balance recorded yet.{' '}
              <Link href="/setup" className="underline decoration-rule-strong underline-offset-4 hover:text-ink">
                Record one in Setup
              </Link>{' '}
              to start tracking performance.
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * One standing check, stated plainly when it holds: "no warning" and "not
 * checked" look identical otherwise.
 */
function Check({ ok, name, children }: { ok: boolean; name: string; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-4 py-3 text-sm">
      <span className={ok ? 'w-24 shrink-0 text-ink-dim' : 'w-24 shrink-0 font-medium text-alert'}>
        <span aria-hidden className="mr-1.5">{ok ? '✓' : '△'}</span>{name}
      </span>
      <span className="text-ink-dim">{children}</span>
    </li>
  );
}

/**
 * Whether the credit cards' purchases can be trusted as a spending record.
 *
 * Card purchases are counted as spending and the payments that settle them are
 * not (they carry necessity 'transfer'), which is only sound while the cards
 * are actually paid off. This is the standing evidence: for each card,
 * charges minus applied payments should equal what the issuer says is owed.
 */
function CardsCheck({ cards }: { cards: CardSettlement[] }) {
  if (cards.length === 0) return null;
  const off = cards.filter((c) => c.gap_cents !== 0);
  const clearing = cards.filter((c) => c.clearing_cents > 0);
  return (
    <Check ok={off.length === 0} name="Cards">
      {off.length === 0 ? (
        <>
          every charge is settled or still owed — the ledger and the issuers agree
          {clearing.map((c) => (
            <span key={c.name} className="ml-2 text-ink-faint">
              ({c.name}: <span className="figure">{formatCents(c.clearing_cents)}</span> clearing)
            </span>
          ))}
        </>
      ) : (
        off.map((c) => (
          <span key={c.name} className="mr-4">
            {c.name} is <span className="figure text-ink">{formatCents(c.gap_cents)}</span> from what its issuer reports
          </span>
        ))
      )}
    </Check>
  );
}

function Line({ label, cents, hint }: { label: string; cents: number; hint?: string }) {
  return (
    <tr className="rule-b">
      <td className="py-3 text-sm">
        {label}
        {hint && <span className="ml-2 text-xs text-ink-faint">{hint}</span>}
      </td>
      <td className="py-3 text-right">
        <Figure cents={cents} tone="neutral" />
      </td>
    </tr>
  );
}
