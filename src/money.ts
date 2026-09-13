/**
 * The ONLY currency conversion/formatting path in the app (DESIGN.md I1).
 *
 * Money is integer cents everywhere. Floats never touch a monetary value except
 * momentarily inside parseCents, which rounds before returning.
 */

/** Parse a currency string ("$1,234.56", "(45.00)", "-12.3") to signed cents. */
export function parseCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Not a finite amount: ${input}`);
    return Math.round(input * 100);
  }

  let s = input.trim();
  if (s === '') throw new Error('Empty amount string');

  // Accounting negatives: (1,234.56)
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/[$\s,]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') {
    throw new Error(`Unparseable amount: ${input}`);
  }

  // Split on the decimal point and scale by string manipulation so that
  // values like 0.29 never pass through binary floating point.
  const [whole, frac = ''] = s.split('.');
  const cents =
    BigInt(whole === '' ? '0' : whole) * 100n +
    BigInt((frac + '00').slice(0, 2).padEnd(2, '0')) +
    // round the third decimal place, if the source had one
    (frac.length > 2 && Number(frac[2]) >= 5 ? 1n : 0n);

  const result = Number(cents);
  if (!Number.isSafeInteger(result)) throw new Error(`Amount out of range: ${input}`);
  return negative ? -result : result;
}

/** Render cents as a display string. The render boundary — nothing downstream. */
export function formatCents(
  cents: number | bigint | null | undefined,
  opts: { signed?: boolean; cents?: boolean; currency?: string } = {},
): string {
  if (cents === null || cents === undefined) return '—';
  const n = typeof cents === 'bigint' ? Number(cents) : cents;
  const { signed = false, cents: showCents = true, currency = 'USD' } = opts;

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(Math.abs(n) / 100);

  if (n < 0) return `-${formatted}`;
  return signed ? `+${formatted}` : formatted;
}

/** Compact form for chart axes and dense tables: $1.2k, $34k, $1.1M */
export function formatCentsCompact(cents: number | bigint | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const n = typeof cents === 'bigint' ? Number(cents) : cents;
  const dollars = Math.abs(n) / 100;
  const sign = n < 0 ? '-' : '';
  if (dollars >= 1_000_000) return `${sign}$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `${sign}$${(dollars / 1_000).toFixed(dollars >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${dollars.toFixed(0)}`;
}

/** Percent change between two cent values. Null when the base is zero. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
