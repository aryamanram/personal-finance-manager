import { describe, it, expect } from 'vitest';
import { normalize, fingerprint, merchantKey } from '@/ingest/fingerprint';

describe('normalize', () => {
  it('uppercases, strips punctuation, collapses whitespace', () => {
    expect(normalize('Whole Foods Mkt.  #10234')).toBe('WHOLE FOODS MKT');
  });

  it('strips trailing store numbers and refs — these churn pending->posted', () => {
    expect(normalize('STARBUCKS #12345')).toBe('STARBUCKS');
    expect(normalize('STARBUCKS #12345 WA')).toBe('STARBUCKS');
    expect(normalize('AMAZON REF: A1B2C3')).toBe('AMAZON');
    expect(normalize('UBER TRIP 08/14')).toBe('UBER TRIP');
  });

  it('strips payment-processor prefixes', () => {
    expect(normalize('SQ *BLUE BOTTLE COFFEE')).toBe('BLUE BOTTLE COFFEE');
    expect(normalize('TST* LOCAL DINER')).toBe('LOCAL DINER');
  });

  it('is stable across pending/posted description drift', () => {
    expect(normalize('STARBUCKS #12345 SEATTLE WA')).toBe(
      normalize('STARBUCKS #98765 SEATTLE WA'),
    );
  });
});

describe('fingerprint', () => {
  const base = {
    accountId: '11111111-1111-1111-1111-111111111111',
    postedDate: '2026-08-05',
    amountCents: -450,
    rawDescription: 'STARBUCKS #12345',
  };

  it('is deterministic', () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base }));
  });

  it('collapses descriptions that normalize the same', () => {
    expect(fingerprint(base)).toBe(
      fingerprint({ ...base, rawDescription: 'STARBUCKS #99999' }),
    );
  });

  it('separates different amounts, dates, and accounts', () => {
    expect(fingerprint({ ...base, amountCents: -451 })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, postedDate: '2026-08-06' })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, accountId: '22222222-2222-2222-2222-222222222222' }))
      .not.toBe(fingerprint(base));
  });
});

describe('merchantKey', () => {
  it('drops corporate suffixes for grouping', () => {
    expect(merchantKey('Blue Bottle Coffee Inc')).toBe('blue bottle coffee');
    expect(merchantKey('SQ *BLUE BOTTLE COFFEE')).toBe('blue bottle coffee');
  });
});
