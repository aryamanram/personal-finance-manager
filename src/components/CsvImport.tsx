'use client';

import { useState, useRef } from 'react';
import { Figure } from './Figure';
import { formatCents } from '@/money';
import type { Account } from '@/lib/types';
import { formatTimestampShort } from '@/lib/format-date';

interface Preview {
  rowCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  totalCents: number;
  signFlipped: boolean;
  warnings: string[];
  alreadyImported: { at: string; rowsInserted: number } | null;
  rows: { postedDate: string; rawDescription: string; amountCents: number; type: string }[];
}

/**
 * Drop zone with a mandatory preview step (DESIGN.md §6). The file is parsed
 * and shown — row count, date range, computed total, sign convention — and
 * nothing is written until the user confirms.
 */
export function CsvImport({ accounts }: { accounts: Account[] }) {
  const csvAccounts = accounts.filter((a) => a.source === 'csv' || a.type === 'credit');
  const [accountId, setAccountId] = useState(csvAccounts[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send(selected: File, commit: boolean) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set('file', selected);
    body.set('account_id', accountId);
    body.set('commit', String(commit));

    try {
      const res = await fetch('/api/import/applecard', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Import failed.');
        return;
      }
      if (commit) {
        const i = data.imported;
        setResult(
          `${i.inserted} imported, ${i.duplicate} already present` +
          (i.adopted ? `, ${i.adopted} matched to existing rows` : '') +
          (i.transfersLinked ? `, ${i.transfersLinked} transfers linked` : ''),
        );
        setPreview(null);
        setFile(null);
      } else {
        setPreview(data.preview);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  function choose(f: File | undefined) {
    if (!f) return;
    setResult(null);
    setPreview(null);
    setFile(f);
    void send(f, false);
  }

  return (
    <div>
      <div className="rule-b flex items-baseline justify-between pb-2">
        <h2 className="eyebrow">Import a statement</h2>
        {csvAccounts.length > 1 && (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="rounded-sm border border-ink-600 bg-ink-800 px-2 py-1 text-xs"
          >
            {csvAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>

      {!preview && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={`mt-4 cursor-pointer border border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? 'border-edited bg-ink-850' : 'border-ink-600 hover:border-ink-500'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <p className="text-sm text-paper-dim">
            {busy ? 'Reading…' : 'Drop an Apple Card CSV here, or click to choose'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-paper-faint">
            Wallet → Apple Card → card balance → the monthly statement →
            Export Transactions. Nothing is written until you confirm.
          </p>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-out">{error}</p>}
      {result && (
        <p className="mt-4 text-sm text-in">
          {result}{' '}
          <a href="/transactions" className="ml-2 border-b border-paper-faint text-paper">
            Open the register →
          </a>
        </p>
      )}

      {preview && file && (
        <div className="mt-4 space-y-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Stat label="Rows" value={String(preview.rowCount)} />
            <Stat
              label="Period"
              value={
                preview.periodStart === preview.periodEnd
                  ? preview.periodStart ?? '—'
                  : `${preview.periodStart} → ${preview.periodEnd}`
              }
            />
            <div>
              <dt className="eyebrow">Net</dt>
              <dd className="mt-1">
                <Figure cents={preview.totalCents} className="text-sm" />
              </dd>
            </div>
            <Stat label="Sign" value={preview.signFlipped ? 'flipped' : 'as written'} />
          </dl>

          {preview.alreadyImported && (
            <p className="text-xs text-edited">
              This exact file was imported on{' '}
              {formatTimestampShort(preview.alreadyImported.at)}. Importing again
              is safe — duplicate rows are counted, not re-inserted.
            </p>
          )}

          {preview.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-edited">
              {preview.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="rule-b">
                  <th className="eyebrow py-1.5 text-left">Date</th>
                  <th className="eyebrow py-1.5 text-left">Description</th>
                  <th className="eyebrow py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="rule-b">
                    <td className="figure py-1.5 text-xs text-paper-faint">{r.postedDate}</td>
                    <td className="truncate py-1.5 pr-4 text-paper-dim">{r.rawDescription}</td>
                    <td className="py-1.5 text-right">
                      <Figure cents={r.amountCents} className="text-xs" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rowCount > preview.rows.length && (
              <p className="py-2 text-xs text-paper-faint">
                …and {preview.rowCount - preview.rows.length} more
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              disabled={busy}
              onClick={() => void send(file, true)}
              className="rounded-sm border border-paper-faint px-4 py-2 text-sm text-paper transition-colors hover:bg-ink-800 disabled:opacity-50"
            >
              {busy ? 'Importing…' : `Import ${preview.rowCount} rows`}
            </button>
            <button
              onClick={() => { setPreview(null); setFile(null); }}
              className="px-3 py-2 text-sm text-paper-faint transition-colors hover:text-paper"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="figure mt-1 text-sm text-paper">{value}</dd>
    </div>
  );
}
