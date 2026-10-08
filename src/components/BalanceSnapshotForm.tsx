'use client';

import { useId, useState } from 'react';

/**
 * The manual "update balance" input (DESIGN.md §13) — one number per month.
 * A snapshot, never a transaction: market movement is neither income nor
 * spending and must not reach the cashflow view.
 */
export function BalanceSnapshotForm({ accountId, accountName }: { accountId: string; accountName?: string }) {
  const id = useId();
  const [amount, setAmount] = useState('');
  // Today where the owner is. toISOString() is UTC, which after 7pm Central
  // is already tomorrow — the form defaulted to a date that had not happened.
  const [asOf, setAsOf] = useState(() => localToday());
  const [state, setState] = useState<{ kind: 'idle' | 'ok' | 'error'; message?: string }>({
    kind: 'idle',
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setState({ kind: 'idle' });

    try {
      const res = await fetch('/api/accounts/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, as_of: asOf, amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: 'error', message: data.error ?? 'Could not save.' });
        return;
      }
      setState({ kind: 'ok', message: 'Balance recorded.' });
      setAmount('');
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setState({ kind: 'error', message: 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-date`} className="sr-only">{accountName ?? 'Balance'} as of</label>
        <input
          id={`${id}-date`}
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="figure rounded-sm border border-rule-strong bg-well px-2 py-1.5 text-sm"
        />
        <label htmlFor={`${id}-amount`} className="sr-only">{accountName ? `${accountName} balance` : 'Balance'}</label>
        <input
          id={`${id}-amount`}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="87,200.00"
          required
          className="figure w-40 rounded-sm border border-rule-strong bg-well px-2 py-1.5 text-sm placeholder:text-ink-faint"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-sm border border-ink-faint px-3 py-1.5 text-sm transition-colors hover:border-ink-faint disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {state.message && (
        <p className={`mt-2 text-xs ${state.kind === 'ok' ? 'text-ink-dim' : 'text-alert'}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

/** yyyy-mm-dd for today in the browser's own time zone. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
