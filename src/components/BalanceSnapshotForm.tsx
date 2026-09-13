'use client';

import { useState } from 'react';

/**
 * The manual "update balance" input (DESIGN.md §13) — one number per month.
 * A snapshot, never a transaction: market movement is neither income nor
 * spending and must not reach the cashflow view.
 */
export function BalanceSnapshotForm({ accountId }: { accountId: string }) {
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
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
    <form onSubmit={submit} className="rule-t pt-4">
      <label className="eyebrow block">Record a balance</label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="figure rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm"
        />
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="87,200.00"
          required
          className="figure w-40 rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm placeholder:text-paper-faint"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-sm border border-ink-500 px-3 py-1.5 text-sm transition-colors hover:border-paper-faint disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {state.message && (
        <p className={`mt-2 text-xs ${state.kind === 'ok' ? 'text-in' : 'text-out'}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
