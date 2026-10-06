'use client';

import { useState } from 'react';
import { Figure } from './Figure';
import type { IncomeSourceRow } from '@/lib/queries';
import type { CategoryWithGroup } from '@/lib/types';

/**
 * Registered payers: money from one of these is filed automatically and never
 * waits in review. Everything else is still a guess to confirm.
 *
 * Added by the text the bank puts in the description — the employer's name is
 * enough, and works before the first deposit has ever arrived.
 */
export function IncomeSources({
  sources,
  categories,
}: {
  sources: IncomeSourceRow[];
  categories: CategoryWithGroup[];
}) {
  const incomeCategories = categories.filter((c) => c.default_necessity === 'income' && !c.is_archived);
  const paycheck = incomeCategories.find((c) => c.name === 'Paycheck') ?? incomeCategories[0];

  const [name, setName] = useState('');
  const [payer, setPayer] = useState('');
  const [categoryId, setCategoryId] = useState(paycheck?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy('add');
    setState(null);
    try {
      const res = await fetch('/api/income-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, match_payer: payer, category_id: categoryId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: 'error', message: data.error ?? 'Could not add the source.' });
        return;
      }
      setState({
        kind: 'ok',
        message: data.filed === 0
          ? `Added ${name}. Its deposits will be filed as they arrive.`
          : `Added ${name} and filed ${data.filed} ${data.filed === 1 ? 'deposit' : 'deposits'}.`,
      });
      setTimeout(() => window.location.reload(), 900);
    } catch {
      setState({ kind: 'error', message: 'Could not add the source.' });
    } finally {
      setBusy(null);
    }
  }

  async function retire(s: IncomeSourceRow) {
    setBusy(s.id);
    setState(null);
    try {
      const res = await fetch(`/api/income-sources/${s.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState({ kind: 'error', message: data.error ?? 'Could not remove the source.' });
        return;
      }
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="mt-3 max-w-lg text-sm leading-relaxed text-paper-dim">
        Money from a payer listed here is filed automatically and skips review.
      </p>

      {sources.length > 0 && (
        <table className="mt-4 w-full">
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="rule-b">
                <td className="py-3 text-sm">
                  {s.name}
                  <span className="ml-2 text-xs text-paper-faint">
                    {s.match_payer ? <>description contains <span className="figure">{s.match_payer}</span></> : null}
                    {s.match_payer && s.match_originator_id ? ' · ' : null}
                    {s.match_originator_id ? <>originator <span className="figure">{s.match_originator_id}</span></> : null}
                  </span>
                </td>
                <td className="py-3 text-xs text-paper-faint">{s.category_name}</td>
                <td className="py-3 text-xs text-paper-faint">
                  {s.deposits === 0
                    ? 'no deposits yet'
                    : `${s.deposits} ${s.deposits === 1 ? 'deposit' : 'deposits'} · last ${s.last_date}`}
                </td>
                <td className="py-3 text-right">
                  {s.last_cents !== null && <Figure cents={s.last_cents} tone="in" />}
                </td>
                <td className="py-3 pl-4 text-right">
                  <button
                    onClick={() => retire(s)}
                    disabled={busy !== null}
                    aria-label={`Remove ${s.name}`}
                    className="text-xs text-paper-faint transition-colors hover:text-paper disabled:opacity-40"
                  >
                    {busy === s.id ? 'Removing…' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} className="mt-6 max-w-2xl rule-t pt-4">
        <span className="eyebrow block">Add a payer</span>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Employer"
            required
            className="w-36 rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm placeholder:text-paper-faint"
          />
          <input
            aria-label="Description contains"
            value={payer}
            onChange={(e) => setPayer(e.target.value)}
            placeholder="Name on the deposit"
            required
            minLength={3}
            className="figure w-60 rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm placeholder:text-paper-faint"
          />
          <select
            aria-label="File as"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-sm border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm"
          >
            {incomeCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-sm border border-ink-500 px-3 py-1.5 text-sm transition-colors hover:border-paper-faint disabled:opacity-50"
          >
            {busy === 'add' ? 'Adding…' : 'Add payer'}
          </button>
        </div>
        <p className="mt-2 text-xs text-paper-faint">
          Matched on incoming money only, ignoring case and spacing.
        </p>
        {state && (
          <p className={`mt-2 text-xs ${state.kind === 'ok' ? 'text-in' : 'text-out'}`}>{state.message}</p>
        )}
      </form>
    </div>
  );
}
