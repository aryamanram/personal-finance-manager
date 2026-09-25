/**
 * What green means in the register.
 *
 * Green is "money you earned", not "positive number". The distinction is not
 * cosmetic: a credit-card payment is +1000 on the CARD, because a positive
 * amount on a liability account means the debt went down. Colouring by sign
 * alone rendered that green, which reads as income from paying off a card.
 *
 * The rule is a pure function of eff_necessity, exported from the component
 * and called here — mirroring it in the test would pass with the real code
 * inverted (CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';
import { amountTone as toneFor } from '@/components/TransactionRow';

describe('only income is green', () => {
  it('greens actual pay', () => {
    expect(toneFor('income')).toBe('in');
  });

  it('does NOT green a credit-card payment, on either leg', () => {
    // +1000 on the card (debt down) and -1000 on checking are the same
    // event. Neither is income, and the sign differs between them, so a
    // sign-based rule necessarily gets one of the two wrong.
    expect(toneFor('transfer')).toBe('neutral');
  });

  it('does NOT green money arriving from your own other account', () => {
    // $36,400 of internal movement was rendering in the same colour as
    // $14,966 of actual pay.
    expect(toneFor('transfer')).toBe('neutral');
  });

  it('leaves spending and investment alone', () => {
    expect(toneFor('required')).toBe('neutral');
    expect(toneFor('discretionary')).toBe('neutral');
    expect(toneFor('investment')).toBe('neutral');
  });
});
