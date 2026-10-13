'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { CategoryPalette } from './CategoryPalette';
import { Figure } from './Figure';
import { formatRegisterDate } from '@/lib/format-date';
import { GUESS_SOURCES, type CategoryWithGroup, type VTransaction } from '@/lib/types';
import type { MerchantContext } from '@/lib/queries';

/**
 * Review: the guesses no human has confirmed, and the rows nobody has filed,
 * worked through from the keyboard (V6).
 *
 *   ↓ / j   next            a / Enter   accept the guess
 *   ↑ / k   previous        c           choose a category
 *   s       skip            m           accept for every row from the merchant
 *
 * Accepting is the register's own confirm: the category is locked and a
 * transaction_edits row is written (V8). Each decision removes the row and
 * the next one is already selected, so a backlog is a run of keystrokes.
 */

type Mode = 'idle' | 'picking' | 'merchant';

const isGuess = (t: VTransaction) =>
  !t.category_locked && t.category_id !== null && GUESS_SOURCES.includes(t.category_source);

export function ReviewInbox({
  rows: initial,
  categories,
  groupSlots,
  colors = {},
}: {
  rows: VTransaction[];
  categories: CategoryWithGroup[];
  /** Each group's palette slot, so a guess shows its group's colour (V10). */
  groupSlots: Record<string, number>;
  /** Each category's own shade, by id (lib/palette.ts). */
  colors?: Record<string, string>;
}) {
  const router = useRouter();
  // Decided here but not yet gone from the server's list: hidden at once, and
  // forgotten when the refreshed list no longer has them.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [merchant, setMerchant] = useState<MerchantContext | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setDone((d) => new Set([...d].filter((id) => initial.some((r) => r.id === id))));
  }, [initial]);

  const rows = useMemo(() => initial.filter((r) => !done.has(r.id)), [initial, done]);
  const at = Math.min(cursor, Math.max(0, rows.length - 1));
  const current = rows[at];

  const colorOf = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    return (id: string | null): string => {
      if (id && colors[id]) return colors[id];
      const c = id ? byId.get(id) : undefined;
      const slot = c ? groupSlots[c.group_name] : undefined;
      return slot ? `var(--color-group-${slot})` : 'var(--color-chart-strong)';
    };
  }, [categories, groupSlots, colors]);

  // What the merchant-wide accept would reach. Fetched for the selected row
  // only, since it is the only row whose actions are on screen.
  useEffect(() => {
    setMerchant(null);
    if (!current?.merchant_id) return;
    let live = true;
    fetch(`/api/transactions/${current.id}/merchant`)
      .then((r) => r.json())
      .then((d) => { if (live) setMerchant(d.merchant ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [current?.id, current?.merchant_id]);

  // Keep the selected row in view as the cursor moves.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at, rows.length]);

  const decide = useCallback(async (
    row: VTransaction,
    categoryId: string,
    opts: { siblings?: boolean; message: string },
  ) => {
    setMode('idle');
    setError(null);
    // The merchant-wide accept takes every row of that merchant off the list.
    const gone = opts.siblings && row.merchant_id
      ? initial.filter((r) => r.merchant_id === row.merchant_id).map((r) => r.id)
      : [row.id];
    setDone((d) => new Set([...d, ...gone]));
    try {
      const res = await fetch(`/api/transactions/${row.id}/merchant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId, apply_to_siblings: !!opts.siblings }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not save that.');
      }
      setSaid(opts.message);
      // The nav badge and this list both come from the server.
      router.refresh();
    } catch (e) {
      setDone((d) => new Set([...d].filter((id) => !gone.includes(id))));
      setError(`${row.eff_description}: ${(e as Error).message}`);
    }
  }, [initial, router]);

  const accept = useCallback(() => {
    if (!current) return;
    if (!isGuess(current)) { setMode('picking'); return; }
    void decide(current, current.category_id!, {
      message: `Accepted ${current.category_name} for ${current.eff_description}.`,
    });
  }, [current, decide]);

  const acceptMerchant = useCallback(() => {
    if (!current || !isGuess(current) || !merchant) return;
    void decide(current, current.category_id!, {
      siblings: true,
      message: `Filed every ${merchant.merchant_name} row as ${current.category_name}.`,
    });
  }, [current, merchant, decide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      // The palette's own search box keeps its keys.
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (mode === 'picking') return;

      if (mode === 'merchant') {
        if (e.key === 'Enter') { e.preventDefault(); acceptMerchant(); }
        if (e.key === 'Escape') { e.preventDefault(); setMode('idle'); }
        return;
      }
      const k = e.key;
      if (k === 'ArrowDown' || k === 'j' || k === 's') { e.preventDefault(); setCursor(Math.min(at + 1, rows.length - 1)); }
      else if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); setCursor(Math.max(at - 1, 0)); }
      else if (k === 'a' || k === 'Enter') {
        // Enter on a focused button is that button's own business.
        if (k === 'Enter' && el?.tagName === 'BUTTON') return;
        e.preventDefault(); accept();
      }
      else if (k === 'c') { e.preventDefault(); if (current) setMode('picking'); }
      else if (k === 'm') {
        e.preventDefault();
        if (current && isGuess(current) && merchant && merchant.siblings > 0) setMode('merchant');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, at, rows.length, current, merchant, accept, acceptMerchant]);

  if (rows.length === 0) {
    return (
      <div className="card px-6 py-16 text-center">
        <p className="text-lg font-medium text-ink">Nothing to review.</p>
        <p className="mt-2 text-sm text-ink-faint">
          Every row in this period has a category a person chose or confirmed.
        </p>
        <p aria-live="polite" className="sr-only">{said}</p>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="card overflow-hidden py-1.5">
        <p aria-live="polite" className="sr-only">{said} {current ? `${rows.length} left.` : ''}</p>
        {error && <p role="alert" className="px-5 pb-1 pt-3 text-xs text-alert">{error}</p>}

        <ol ref={listRef} aria-label="Transactions to review">
          {rows.map((r, i) => {
            const selected = i === at;
            const guess = isGuess(r);
            const swatch = colorOf(r.category_id);
            return (
              <li
                key={r.id}
                aria-current={selected ? 'true' : undefined}
                onClick={() => { if (!selected) { setCursor(i); setMode('idle'); } }}
                className={clsx(
                  'border-l-2 transition-colors',
                  i < rows.length - 1 && 'rule-b',
                  selected ? 'border-l-ink bg-well/50' : 'cursor-pointer border-l-transparent hover:bg-well/30',
                )}
              >
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 px-4 py-2.5 sm:px-5 sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,14rem)_7rem]">
                  <span className="figure text-xs text-ink-faint">{formatRegisterDate(r.eff_posted_date)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{r.eff_description}</span>
                    {/* The category has no column of its own on a phone. */}
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-dim sm:hidden">
                      {r.category_id && (
                        <span aria-hidden className="swatch" style={{ background: swatch }} />
                      )}
                      {r.category_name ?? 'Uncategorized'}
                    </span>
                    {selected && (
                      <span className="mt-0.5 block truncate text-xs text-ink-faint">
                        {r.account_name}
                        {r.description && <> · <span className="figure">{r.raw_description}</span></>}
                      </span>
                    )}
                  </span>
                  <span className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
                    {r.category_id ? (
                      <>
                        <span aria-hidden className="swatch" style={{ background: swatch }} />
                        <span className="truncate text-ink-dim">{r.category_name}</span>
                      </>
                    ) : (
                      <span className="text-ink-faint">Uncategorized</span>
                    )}
                  </span>
                  <span className="text-right">
                    <Figure cents={r.eff_amount_cents} tone={r.eff_necessity === 'income' ? 'in' : 'neutral'} className="text-sm" />
                  </span>
                </div>

                {selected && (
                  <div className="px-4 pb-3 pl-[6.25rem] sm:px-5 sm:pl-[6.75rem]">
                    {guess && r.suggested_reason && (
                      <p className="mb-2 text-xs text-ink-faint">Guessed: {r.suggested_reason}</p>
                    )}
                    {mode === 'picking' ? (
                      <CategoryPalette
                        categories={categories}
                        groupSlots={groupSlots}
                        colors={colors}
                        currentId={r.category_id}
                        clearLabel={{ name: 'Decide later', hint: 'skip' }}
                        onPick={(id) => {
                          if (id) {
                            const picked = categories.find((c) => c.id === id);
                            void decide(r, id, { message: `Filed ${r.eff_description} as ${picked?.name ?? 'that'}.` });
                          } else {
                            setMode('idle');
                            setCursor(Math.min(at + 1, rows.length - 1));
                          }
                        }}
                        onClose={() => setMode('idle')}
                      />
                    ) : mode === 'merchant' && merchant ? (
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="text-ink">
                          File this and {merchant.siblings} other {merchant.merchant_name}{' '}
                          {merchant.siblings === 1 ? 'row' : 'rows'} as {r.category_name}?
                        </span>
                        <Action k="Enter" onClick={acceptMerchant} primary>Yes, all of them</Action>
                        <Action k="Esc" onClick={() => setMode('idle')}>Cancel</Action>
                        <span className="w-full text-ink-faint">Rows you decided by hand are never touched.</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {guess ? (
                          <Action k="A" onClick={accept} primary>Accept {r.category_name}</Action>
                        ) : null}
                        <Action k="C" onClick={() => setMode('picking')} primary={!guess}>
                          {guess ? 'Change' : 'Choose a category'}
                        </Action>
                        {guess && merchant && merchant.siblings > 0 && (
                          <Action k="M" onClick={() => setMode('merchant')}>
                            All {merchant.siblings + 1} from {merchant.merchant_name}
                          </Action>
                        )}
                        <Action k="S" onClick={() => setCursor(Math.min(at + 1, rows.length - 1))}>Skip</Action>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <aside className="sticky top-8 hidden lg:block" aria-label="Keys">
        <div className="card px-5 pb-5 pt-4 text-xs">
          <h2 className="eyebrow">Keys</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-ink-dim">
            <Key k="↓ j">Next</Key>
            <Key k="↑ k">Previous</Key>
            <Key k="a ⏎">Accept the guess</Key>
            <Key k="c">Choose a category</Key>
            <Key k="m">Every row from this merchant</Key>
            <Key k="s">Skip</Key>
            <Key k="esc">Back out</Key>
          </dl>
          <p className="mt-4 leading-relaxed text-ink-faint">
            Accepting locks the category, as confirming in the register does:
            no rule or guess will change it again.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Action({
  k, onClick, primary, children,
}: { k: string; onClick: () => void; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={clsx(
        'flex items-center gap-2 rounded-sm border px-2.5 py-1.5 transition-colors',
        primary ? 'border-ink bg-ink text-ground hover:opacity-90' : 'border-rule-strong text-ink hover:border-ink-faint',
      )}
    >
      <kbd className={clsx('figure rounded-[2px] px-1 text-[10px]', primary ? 'bg-ground/20' : 'bg-well text-ink-dim')}>{k}</kbd>
      {children}
    </button>
  );
}

function Key({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt><kbd className="figure rounded-[2px] bg-well px-1.5 py-0.5 text-[10px] text-ink">{k}</kbd></dt>
      <dd>{children}</dd>
    </>
  );
}
