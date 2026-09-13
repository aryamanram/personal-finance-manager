import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAppleCardCsv, parseCsvDate } from '@/ingest/applecard-csv';

const negative = readFileSync('fixtures/applecard-negative.csv', 'utf8');
const positive = readFileSync('fixtures/applecard-positive.csv', 'utf8');

describe('parseCsvDate', () => {
  it('accepts Apple MM/DD/YYYY and ISO', () => {
    expect(parseCsvDate('08/05/2026')).toBe('2026-08-05');
    expect(parseCsvDate('8/5/2026')).toBe('2026-08-05');
    expect(parseCsvDate('2026-08-05')).toBe('2026-08-05');
  });
});

describe('sign detection — DESIGN.md §6.1', () => {
  it('leaves a negative-for-purchase file alone', () => {
    const r = parseAppleCardCsv(negative);
    expect(r.signFlipped).toBe(false);
    const apple = r.rows.find((x) => x.rawDescription.includes('APPLE.COM'))!;
    expect(apple.amountCents).toBe(-299);
  });

  it('flips a positive-for-purchase file', () => {
    const r = parseAppleCardCsv(positive);
    expect(r.signFlipped).toBe(true);
    const apple = r.rows.find((x) => x.rawDescription.includes('APPLE.COM'))!;
    expect(apple.amountCents).toBe(-299);
  });

  it('produces identical output from both conventions', () => {
    const a = parseAppleCardCsv(negative);
    const b = parseAppleCardCsv(positive);
    expect(b.rows.map((r) => r.amountCents)).toEqual(a.rows.map((r) => r.amountCents));
    expect(b.totalCents).toBe(a.totalCents);
  });

  it('warns when it flips, so the preview can surface it', () => {
    expect(parseAppleCardCsv(positive).warnings.join(' ')).toMatch(/flipped/i);
  });

  it('keeps purchases negative and payments positive', () => {
    for (const content of [negative, positive]) {
      const r = parseAppleCardCsv(content);
      const payment = r.rows.find((x) => x.type === 'Payment')!;
      expect(payment.amountCents).toBe(11551);
      const purchases = r.rows.filter((x) => x.type === 'Transaction');
      expect(purchases.every((p) => p.amountCents < 0)).toBe(true);
    }
  });
});

describe('Daily Cash — must never become income', () => {
  it('flags the row and keeps it positive as a credit', () => {
    for (const content of [negative, positive]) {
      const r = parseAppleCardCsv(content);
      const dc = r.rows.find((x) => x.isDailyCash)!;
      expect(dc).toBeDefined();
      expect(dc.amountCents).toBe(229);
    }
  });
});

describe('file identity', () => {
  it('hashes content for the re-import short-circuit', () => {
    expect(parseAppleCardCsv(negative).fileSha256).toHaveLength(64);
    expect(parseAppleCardCsv(negative).fileSha256)
      .toBe(parseAppleCardCsv(negative).fileSha256);
    expect(parseAppleCardCsv(positive).fileSha256)
      .not.toBe(parseAppleCardCsv(negative).fileSha256);
  });

  it('reports period and total for the preview', () => {
    const r = parseAppleCardCsv(negative);
    expect(r.periodStart).toBe('2026-08-03');
    expect(r.periodEnd).toBe('2026-08-22');
    expect(r.rows).toHaveLength(7);
  });
});
