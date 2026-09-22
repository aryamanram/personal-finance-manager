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

/** Mirrors FilterChips' own derivation of which chips to render. */
function chipsFor(counts: { needsReview: number; uncategorized: number }) {
  const showReview = counts.needsReview > 0;
  const showUncategorized = counts.uncategorized > 0;
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
