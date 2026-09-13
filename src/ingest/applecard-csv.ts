/**
 * Apple Card CSV import (DESIGN.md §6).
 *
 * Export path: Wallet -> Apple Card -> card balance -> monthly statement ->
 * Export Transactions -> CSV.
 *
 * Columns: Date, Type, Description, Daily Cash (%), Daily Cash ($), Amount
 *
 * Two hazards handled here:
 *   1. Sign convention is not guaranteed. Detect it, don't assume it.
 *   2. Daily Cash rows are cashback and must NOT land in income, or monthly
 *      income creeps upward by a few dollars forever.
 */
import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { parseCents } from '../money';
import type { CanonicalTxn, TxnStatus } from '../lib/types';

export interface ParsedCsvRow {
  postedDate: string;
  rawDescription: string;
  amountCents: number;      // account perspective: negative = outflow
  type: string;
  importedCategory: string | null;
  isDailyCash: boolean;
  status: TxnStatus;
}

export interface CsvParseResult {
  rows: ParsedCsvRow[];
  /** Whether the file's Amount column was positive-for-purchase (and flipped). */
  signFlipped: boolean;
  warnings: string[];
  periodStart: string | null;
  periodEnd: string | null;
  totalCents: number;
  fileSha256: string;
}

const DATE_KEYS = ['Transaction Date', 'Date', 'Clearing Date'];
const DESC_KEYS = ['Description', 'Merchant', 'Name'];
const AMOUNT_KEYS = ['Amount (USD)', 'Amount'];
const TYPE_KEYS = ['Type'];
const CATEGORY_KEYS = ['Category'];
const DAILY_CASH_KEYS = ['Daily Cash ($)', 'Daily Cash'];

function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  // Case/whitespace-insensitive fallback — Apple has renamed these headers.
  const lower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v !== undefined && v !== '') return v;
  }
  return null;
}

/** Apple writes MM/DD/YYYY; accept ISO too. Returns ISO yyyy-mm-dd. */
export function parseCsvDate(input: string): string {
  const s = input.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new Error(`Unparseable date: "${input}"`);
}

/** Row types that are money coming back TO the card, not a purchase. */
function isInflowType(type: string): boolean {
  return /payment|credit|refund|return|reversal|daily\s*cash/i.test(type);
}

export function isDailyCashRow(type: string, description: string): boolean {
  return /daily\s*cash/i.test(type) || /daily\s*cash/i.test(description);
}

export function parseAppleCardCsv(content: string): CsvParseResult {
  const warnings: string[] = [];
  const fileSha256 = createHash('sha256').update(content).digest('hex');

  const records = parse(content, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return {
      rows: [], signFlipped: false, warnings: ['File contains no data rows.'],
      periodStart: null, periodEnd: null, totalCents: 0, fileSha256,
    };
  }

  // --- Stage 1: parse raw, preserving the file's own sign ------------------
  interface Raw {
    postedDate: string; rawDescription: string; fileAmountCents: number;
    type: string; importedCategory: string | null; isDailyCash: boolean;
  }
  const raw: Raw[] = [];

  records.forEach((rec, i) => {
    const dateStr = pick(rec, DATE_KEYS);
    const desc = pick(rec, DESC_KEYS);
    let amountStr = pick(rec, AMOUNT_KEYS);
    const type = pick(rec, TYPE_KEYS) ?? 'Transaction';
    const dailyCashStr = pick(rec, DAILY_CASH_KEYS);

    const dailyCash = isDailyCashRow(type, desc ?? '');

    // A Daily Cash-typed row may carry its value only in the Daily Cash column.
    if ((amountStr === null || amountStr === '0' || amountStr === '0.00') && dailyCash && dailyCashStr) {
      amountStr = dailyCashStr;
    }

    if (!dateStr || !desc || amountStr === null) {
      warnings.push(`Row ${i + 2}: missing date, description, or amount — skipped.`);
      return;
    }

    let fileAmountCents: number;
    try {
      fileAmountCents = parseCents(amountStr);
    } catch {
      warnings.push(`Row ${i + 2}: unparseable amount "${amountStr}" — skipped.`);
      return;
    }
    if (fileAmountCents === 0) {
      warnings.push(`Row ${i + 2}: zero amount — skipped (schema forbids it).`);
      return;
    }

    raw.push({
      postedDate: parseCsvDate(dateStr),
      rawDescription: desc,
      fileAmountCents,
      type,
      importedCategory: pick(rec, CATEGORY_KEYS),
      isDailyCash: dailyCash,
    });
  });

  // --- Stage 2: sign detection (DESIGN.md §6.1) ----------------------------
  // Purchases must end up negative. Judge on purchase-typed rows only: a
  // statement that is mostly payments must not flip the whole file.
  const purchases = raw.filter((r) => !r.isDailyCash && !isInflowType(r.type));
  const negatives = purchases.filter((r) => r.fileAmountCents < 0).length;
  const signFlipped = purchases.length > 0 && negatives < purchases.length / 2;

  if (signFlipped) {
    warnings.push(
      `Amount column is positive-for-purchase (${purchases.length - negatives}/${purchases.length} ` +
      `purchase rows positive). Signs flipped so outflows are negative.`,
    );
  } else if (purchases.length > 0 && negatives !== purchases.length) {
    warnings.push(
      `Mixed signs on purchase rows (${negatives}/${purchases.length} negative). ` +
      `Review the preview before importing.`,
    );
  }

  const rows: ParsedCsvRow[] = raw.map((r) => {
    let amountCents = signFlipped ? -r.fileAmountCents : r.fileAmountCents;

    // Daily Cash is cashback: it nets against spending as a credit on the card.
    // Force it positive regardless of how the file wrote it, and never let the
    // categorizer treat it as income (see appleCardCanonical below).
    if (r.isDailyCash) amountCents = Math.abs(amountCents);

    // A payment/refund is money back to the card: positive from the account's
    // perspective. Only correct it when the file disagrees.
    if (!r.isDailyCash && isInflowType(r.type) && amountCents < 0) {
      amountCents = -amountCents;
    }

    return {
      postedDate: r.postedDate,
      rawDescription: r.rawDescription,
      amountCents,
      type: r.type,
      importedCategory: r.importedCategory,
      isDailyCash: r.isDailyCash,
      status: 'posted' as TxnStatus,
    };
  });

  const dates = rows.map((r) => r.postedDate).sort();
  return {
    rows,
    signFlipped,
    warnings,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    totalCents: rows.reduce((a, r) => a + r.amountCents, 0),
    fileSha256,
  };
}

/** Map parsed rows to the canonical shape upsertTransactions() consumes. */
export function toCanonical(rows: ParsedCsvRow[], accountId: string): CanonicalTxn[] {
  return rows.map((r) => ({
    accountId,
    amountCents: r.amountCents,
    postedDate: r.postedDate,
    status: r.status,
    rawDescription: r.rawDescription,
    externalId: null,          // CSV rows never have one — that's what makes adoption work
    source: 'csv' as const,
    // Route Daily Cash to its own category name so it nets against spending
    // rather than inflating income.
    importedCategory: r.isDailyCash ? 'Daily Cash' : r.importedCategory,
  }));
}
