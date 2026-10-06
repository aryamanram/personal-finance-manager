/**
 * The deterministic guesser (src/categorize/guess.ts). Pure: no database.
 *
 * Merchant names here are invented. Real ones never go in a test fixture.
 */
import { describe, it, expect } from 'vitest';
import { buildModel, guess, nameWords, railOf, type Decision } from '@/categorize/guess';

const CATS = [
  { id: 'gas', name: 'Gas' },
  { id: 'groc', name: 'Groceries' },
  { id: 'rest', name: 'Restaurants' },
  { id: 'shop', name: 'Shopping' },
  { id: 'reimb', name: 'Reimbursement' },
  { id: 'fees', name: 'Fees & Interest' },
  { id: 'cash', name: 'Cash Withdrawn' },
  { id: 'ccpay', name: 'Credit Card Payment' },
  { id: 'coffee', name: 'Coffee' },
  { id: 'subs', name: 'Subscriptions' },
  { id: 'stream', name: 'Streaming & Video', parent_id: 'subs' },
  { id: 'music', name: 'Music & Audio', parent_id: 'subs' },
  { id: 'adult', name: 'Adult', parent_id: 'subs' },
];

const d = (raw: string, cat: string, date: string, amount = -1000, accountType: Decision['accountType'] = 'credit'): Decision =>
  ({ rawDescription: raw, categoryId: cat, postedDate: date, amountCents: amount, accountType });

const out = (raw: string, accountType: Decision['accountType'] = 'credit') =>
  ({ rawDescription: raw, amountCents: -1500, accountType });

describe('name words', () => {
  it('drops rail words, reference codes and store numbers, keeps the payee', () => {
    expect(nameWords('Zelle payment to JANE DOE JPM99abc123')).toEqual(['jane', 'doe']);
    expect(nameWords('ACME FUEL #0348 SPRINGFIELD IL 328717 10/02')).toEqual(['acme', 'fuel', 'springfield']);
  });

  it('keys a rail on its whole leading run, so two PayPal products are two rails', () => {
    expect(railOf('PAYPAL INST XFER SOMEONE WEB ID: X1')).toBe('paypal inst xfer');
    expect(railOf('PAYPAL PURCHASE SOMETHING WEB ID: X1')).toBe('paypal purchase');
    expect(railOf('THE CORNER SHOP')).toBeNull();
  });
});

describe('step 1: the same merchant', () => {
  it('takes the most recent decision and reports how many agreed', () => {
    const m = buildModel([
      d('WIDGETCO 123', 'shop', '2026-01-01'),
      d('WIDGETCO 456', 'shop', '2026-02-01'),
      d('WIDGETCO 789', 'rest', '2026-03-01'),
    ], CATS);
    const g = guess(out('WIDGETCO 999'), m)!;
    expect(g.categoryId).toBe('rest');
    expect(g.step).toBe('merchant');
    // 1 of 3 agree, several decisions: 1/3 × 0.95 = 0.3166… → 0.32
    expect(g.confidence).toBe(0.32);
    expect(g.reason).toBe('1 of 3 past "widgetco" → Restaurants');
  });

  it('is confident when every past decision agrees', () => {
    const m = buildModel([d('WIDGETCO', 'shop', '2026-01-01'), d('WIDGETCO', 'shop', '2026-02-01')], CATS);
    expect(guess(out('WIDGETCO'), m)!.confidence).toBe(0.95);
    // One past decision is less evidence than two.
    const one = buildModel([d('WIDGETCO', 'shop', '2026-01-01')], CATS);
    expect(guess(out('WIDGETCO'), one)!.confidence).toBe(0.85);
  });

  it('counts a parent-filed decision toward its own subcategory', () => {
    // 3 at the subcategory, then 1 at the bare parent MOST RECENTLY. The
    // parent is the same answer, less specific — it must not win.
    const m = buildModel([
      d('STREAMFLIX', 'stream', '2026-01-01'),
      d('STREAMFLIX', 'stream', '2026-02-01'),
      d('STREAMFLIX', 'stream', '2026-03-01'),
      d('STREAMFLIX', 'subs', '2026-04-01'),
    ], CATS);
    const g = guess(out('STREAMFLIX'), m)!;
    expect(g.categoryId).toBe('stream');
    expect(g.reason).toBe('4 of 4 past "streamflix" → Streaming & Video');
  });

  it('leaves parent votes alone when two different children appear', () => {
    const m = buildModel([
      d('MEDIAHUB', 'stream', '2026-01-01'),
      d('MEDIAHUB', 'music', '2026-02-01'),
      d('MEDIAHUB', 'subs', '2026-03-01'),
    ], CATS);
    expect(guess(out('MEDIAHUB'), m)!.categoryId).toBe('subs');
  });

  it('beats a structural pattern: the owner\'s own filing of a descriptor wins', () => {
    // "MONTHLY SERVICE FEE" reads as a bank fee, but if the owner files it
    // elsewhere every time, that is what it is.
    const m = buildModel([d('MONTHLY SERVICE FEE', 'adult', '2026-01-01', -1200, 'depository')], CATS);
    expect(guess(out('MONTHLY SERVICE FEE', 'depository'), m)!.categoryId).toBe('adult');
    expect(guess(out('MONTHLY SERVICE FEE', 'depository'), buildModel([], CATS))!.categoryId).toBe('fees');
  });
});

describe('direction', () => {
  const m = buildModel([
    d('Zelle payment to JANE DOE ABC123', 'rest', '2026-01-01', -2000, 'depository'),
    d('Zelle payment from JANE DOE XYZ789', 'reimb', '2026-01-02', 2000, 'depository'),
  ], CATS);

  it('keeps money in and money out apart on the same rail and person', () => {
    expect(guess({ rawDescription: 'Zelle payment to JANE DOE QQQ111', amountCents: -500, accountType: 'depository' }, m)!.categoryId).toBe('rest');
    expect(guess({ rawDescription: 'Zelle payment from JANE DOE QQQ222', amountCents: 500, accountType: 'depository' }, m)!.categoryId).toBe('reimb');
  });

  it('lets a card refund learn from the purchases it reverses', () => {
    const shop = buildModel([d('WIDGETCO', 'shop', '2026-01-01', -5000, 'credit')], CATS);
    expect(guess({ rawDescription: 'WIDGETCO', amountCents: 5000, accountType: 'credit' }, shop)!.categoryId).toBe('shop');
    // Money IN on checking is not a refund of a purchase.
    expect(guess({ rawDescription: 'WIDGETCO', amountCents: 5000, accountType: 'depository' }, shop)).toBeNull();
  });
});

describe('steps 3 and 5: shared leading name words', () => {
  const m = buildModel([
    d('ACME FUEL #0348 SPRINGFIELD IL', 'gas', '2026-01-01'),
    d('ACME FUEL #0122 SHELBYVILLE IL', 'gas', '2026-02-01'),
    d('ACME WAREHOUSE #0348 SPRINGFIELD IL', 'groc', '2026-02-02'),
    d('LUIGIS TRATTORIA SPRINGFIELD IL', 'rest', '2026-02-03'),
  ], CATS);

  it('matches a new location of a known merchant on its leading words', () => {
    const g = guess(out('ACME FUEL #0999 OGDENVILLE IL'), m)!;
    expect(g.categoryId).toBe('gas');
    expect(g.step).toBe('name');
    expect(g.reason).toBe('like past "acme fuel …" → Gas (2 of 2)');
  });

  it('prefers the longest shared prefix', () => {
    expect(guess(out('ACME WAREHOUSE #0001 OGDENVILLE IL'), m)!.categoryId).toBe('groc');
  });

  it('never matches on a shared trailing city', () => {
    // Shares "springfield" with three decided rows — and nothing else.
    expect(guess(out('DUSTY BOOKS SPRINGFIELD IL'), m)).toBeNull();
  });

  it('ranks a one-word match below a known chain', () => {
    const one = buildModel([d('STARBUCKS LOYALTY TOPUP', 'shop', '2026-01-01')], CATS);
    // Shares only "starbucks" with the history; the keyword table says Coffee.
    const g = guess(out('STARBUCKS #1234 SPRINGFIELD'), one)!;
    expect(g.categoryId).toBe('coffee');
    expect(g.step).toBe('keyword');
  });
});

describe('step 6: the rail', () => {
  it('falls back to what most money on this rail, this direction, was for', () => {
    const m = buildModel([
      d('Zelle payment to ANN A1', 'rest', '2026-01-01', -100, 'depository'),
      d('Zelle payment to BOB B1', 'rest', '2026-01-02', -100, 'depository'),
      d('Zelle payment to CAL C1', 'shop', '2026-01-03', -100, 'depository'),
      d('Zelle payment from DEE D1', 'reimb', '2026-01-04', 100, 'depository'),
    ], CATS);
    const g = guess({ rawDescription: 'Zelle payment to NEW PERSON N1', amountCents: -100, accountType: 'depository' }, m)!;
    expect(g.categoryId).toBe('rest');
    expect(g.step).toBe('rail');
    // 2 of 3 outgoing: 0.4 × 2/3 = 0.2666… → 0.27. The incoming one is not counted.
    expect(g.confidence).toBe(0.27);
    expect(g.reason).toBe('most "zelle payment to …" sent → Restaurants (2 of 3)');
  });
});

describe('patterns', () => {
  const empty = buildModel([], CATS);

  it('recognises what a description says about itself', () => {
    expect(guess(out('NON-CHASE ATM WITHDRAW 123 MAIN ST', 'depository'), empty)!.categoryId).toBe('cash');
    expect(guess({ rawDescription: 'Payment Thank You-Mobile', amountCents: 5000, accountType: 'credit' }, empty)!.categoryId).toBe('ccpay');
    expect(guess({ rawDescription: 'VENMO            CASHOUT   PPD ID: 1', amountCents: 5000, accountType: 'depository' }, empty)!.categoryId).toBe('reimb');
  });

  it('drops a pattern whose category does not exist rather than inventing one', () => {
    // No 'Rideshare' in CATS.
    expect(guess(out('LYFT *RIDE SUN 8PM'), empty)).toBeNull();
  });

  it('returns nothing when nothing fits', () => {
    expect(guess(out('QZX HOLDINGS 4471'), empty)).toBeNull();
  });
});
