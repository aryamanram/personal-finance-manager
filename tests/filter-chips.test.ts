/**
 * Which filter chips the register offers.
 *
 * A backlog chip is a to-do. The steady state of this ledger is that every
 * month gets confirmed, so the interesting case is the one where both backlogs
 * are empty — the register should read as finished, not show two greyed-out
 * controls that filter to nothing.
 *
 * The component is a thin renderer over this decision, so the decision is
 * tested directly.
 */
import { describe, it, expect } from 'vitest';
import { toggleHref, clearBacklogHref, backlogChips } from '@/components/FilterChips';

const P = '/transactions';
/** A realistic URL: both backlog filters plus filters that must survive. */
const busy = () => new URLSearchParams({
  review: '1', uncategorized: '1',
  q: 'coffee', account: 'abc-123', from: '2026-01-01', to: '2026-01-31',
});

const NONE = { review: false, uncategorized: false };

/**
 * The chips the component renders, derived from ITS OWN backlogChips() rather
 * than a copy of it. The previous version of this helper re-implemented the
 * conditions, so reversing them in the component failed nothing.
 */
function chipsFor(
  counts: { needsReview: number; uncategorized: number },
  active: { review: boolean; uncategorized: boolean } = NONE,
) {
  const { showReview, showUncategorized } = backlogChips(counts, active);
  const out: string[] = [];
  if (showReview || showUncategorized) out.push('All');
  if (showReview) out.push('Needs review');
  if (showUncategorized) out.push('Uncategorized');
  if (!showReview && !showUncategorized) out.push('Everything is categorised.');
  out.push('Voided');
  return out;
}

describe('filter chips', () => {
  it('offers a backlog chip only when there is a backlog', () => {
    expect(chipsFor({ needsReview: 339, uncategorized: 0 }))
      .toEqual(['All', 'Needs review', 'Voided']);
  });

  it('offers both when both have work', () => {
    expect(chipsFor({ needsReview: 12, uncategorized: 3 }))
      .toEqual(['All', 'Needs review', 'Uncategorized', 'Voided']);
  });

  it('says so plainly when there is nothing left to review', () => {
    // The steady state, after a month has been confirmed. Two greyed-out
    // chips filtering to an empty table is worse than a sentence.
    expect(chipsFor({ needsReview: 0, uncategorized: 0 }))
      .toEqual(['Everything is categorised.', 'Voided']);
  });

  it('always keeps the voided toggle, which is a view and not a backlog', () => {
    for (const counts of [
      { needsReview: 0, uncategorized: 0 },
      { needsReview: 5, uncategorized: 0 },
      { needsReview: 0, uncategorized: 5 },
    ]) {
      expect(chipsFor(counts)).toContain('Voided');
    }
  });

  it('offers "All" whenever a backlog filter could be on', () => {
    // Without it, nothing-selected and everything-selected look identical.
    expect(chipsFor({ needsReview: 1, uncategorized: 0 })).toContain('All');
    expect(chipsFor({ needsReview: 0, uncategorized: 0 })).not.toContain('All');
  });
});

describe('the All link', () => {
  it('drops both backlog filters and keeps everything else', () => {
    const url = new URL(clearBacklogHref(P, busy()), 'http://x');
    expect(url.pathname).toBe(P);
    expect(url.searchParams.get('review')).toBeNull();
    expect(url.searchParams.get('uncategorized')).toBeNull();
    // The filters All must NOT touch — clearing a search the user typed, or
    // silently widening a date range, would be a data-correctness bug wearing
    // a UI costume.
    expect(url.searchParams.get('q')).toBe('coffee');
    expect(url.searchParams.get('account')).toBe('abc-123');
    expect(url.searchParams.get('from')).toBe('2026-01-01');
    expect(url.searchParams.get('to')).toBe('2026-01-31');
  });

  it('returns a bare path when nothing else is set', () => {
    expect(clearBacklogHref(P, new URLSearchParams({ review: '1' }))).toBe(P);
  });

  it('is a no-op when no backlog filter is on', () => {
    const params = new URLSearchParams({ q: 'rent' });
    expect(clearBacklogHref(P, params)).toBe(`${P}?q=rent`);
  });
});

describe('toggling one filter', () => {
  it('turns a filter on without disturbing the rest', () => {
    const url = new URL(
      toggleHref(P, new URLSearchParams({ q: 'rent' }), 'review', false),
      'http://x',
    );
    expect(url.searchParams.get('review')).toBe('1');
    expect(url.searchParams.get('q')).toBe('rent');
  });

  it('turns a filter off again', () => {
    const url = new URL(
      toggleHref(P, new URLSearchParams({ review: '1', q: 'rent' }), 'review', true),
      'http://x',
    );
    expect(url.searchParams.get('review')).toBeNull();
    expect(url.searchParams.get('q')).toBe('rent');
  });

  it('never holds both backlog filters at once', () => {
    // They are alternatives: a row cannot be both machine-guessed and
    // uncategorised, so holding both asks for an empty table.
    const url = new URL(
      toggleHref(P, new URLSearchParams({ uncategorized: '1' }), 'review', false),
      'http://x',
    );
    expect(url.searchParams.get('review')).toBe('1');
    expect(url.searchParams.get('uncategorized')).toBeNull();
  });

  it('leaves the voided toggle alone — it is a view, not a backlog', () => {
    const url = new URL(
      toggleHref(P, new URLSearchParams({ voided: '1' }), 'review', false),
      'http://x',
    );
    expect(url.searchParams.get('voided')).toBe('1');
    expect(url.searchParams.get('review')).toBe('1');
  });
});

describe('a chip whose filter is on stays visible at zero', () => {
  it('keeps the chip and All after the last row is confirmed', () => {
    // The workflow this protects: filter to "Needs review", confirm the final
    // row, count drops to 0. Hiding the chip and All here would leave
    // ?review=1 in the URL with no visible way back to everything.
    expect(chipsFor({ needsReview: 0, uncategorized: 0 }, { review: true, uncategorized: false }))
      .toEqual(['All', 'Needs review', 'Voided']);
  });

  it('still says nothing is left when no filter is on', () => {
    expect(chipsFor({ needsReview: 0, uncategorized: 0 }))
      .toEqual(['Everything is categorised.', 'Voided']);
  });

  it('reports filtering only while a backlog filter is active', () => {
    const counts = { needsReview: 5, uncategorized: 0 };
    expect(backlogChips(counts, NONE).filtering).toBe(false);
    expect(backlogChips(counts, { review: true, uncategorized: false }).filtering).toBe(true);
    expect(backlogChips(counts, { review: false, uncategorized: true }).filtering).toBe(true);
  });
});
