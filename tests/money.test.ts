import { describe, it, expect } from 'vitest';
import { parseCents, formatCents, formatCentsCompact, pctChange } from '@/money';

describe('parseCents', () => {
  it('parses plain and formatted amounts', () => {
    expect(parseCents('12.34')).toBe(1234);
    expect(parseCents('$1,234.56')).toBe(123456);
    expect(parseCents('-45.00')).toBe(-4500);
    expect(parseCents('0.29')).toBe(29);
    expect(parseCents('100')).toBe(10000);
    expect(parseCents('.50')).toBe(50);
  });

  it('handles accounting negatives', () => {
    expect(parseCents('(1,234.56)')).toBe(-123456);
    expect(parseCents('($45.00)')).toBe(-4500);
  });

  it('avoids float representation error', () => {
    // 0.1 + 0.2 territory: these must be exact.
    expect(parseCents('1.15')).toBe(115);
    expect(parseCents('8.87')).toBe(887);
    expect(parseCents('1064.99')).toBe(106499);
    expect(parseCents('0.07')).toBe(7);
  });

  it('rounds a third decimal place', () => {
    expect(parseCents('1.005')).toBe(101);
    expect(parseCents('1.004')).toBe(100);
  });

  it('rejects garbage', () => {
    expect(() => parseCents('abc')).toThrow();
    expect(() => parseCents('')).toThrow();
    expect(() => parseCents('1.2.3')).toThrow();
  });
});

describe('formatCents', () => {
  it('formats at the render boundary', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-4500)).toBe('-$45.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(null)).toBe('—');
    expect(formatCents(250000, { cents: false })).toBe('$2,500');
    expect(formatCents(4500, { signed: true })).toBe('+$45.00');
  });

  it('formats compactly for axes', () => {
    expect(formatCentsCompact(123456)).toBe('$1.2k');
    expect(formatCentsCompact(3456789)).toBe('$35k');
    expect(formatCentsCompact(-450000)).toBe('-$4.5k');
    expect(formatCentsCompact(8712)).toBe('$87');
  });
});

describe('pctChange', () => {
  it('returns null against a zero base', () => {
    expect(pctChange(100, 0)).toBeNull();
  });
  it('computes against the magnitude of the base', () => {
    expect(pctChange(150, 100)).toBeCloseTo(50);
    expect(pctChange(50, 100)).toBeCloseTo(-50);
  });
});
