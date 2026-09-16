/**
 * Chase checking/savings CSV import.
 *
 * Columns: Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #
 *
 * Unlike the Apple Card export, Chase writes the sign from the account's own
 * perspective already (negative = outflow), which matches the schema. Sign
 * detection still runs, but it is a guard rather than a correction: if a future
 * export flips convention, the importer says so instead of silently inverting
 * every balance.
 *
 * The Balance column is a running balance, deliberately ignored. It is only
 * meaningful in the file's own ordering and would conflict with
 * accounts.balance_cents, which the sync owns.
 */
import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { parseCents } from '../money';
import type { CanonicalTxn, TxnStatus } from '../lib/types';

export interface ParsedChaseRow {
  postedDate: string;
  rawDescription: string;
  amountCents: number;
  type: string;
  details: string;
  status: TxnStatus;
}

export interface ChaseParseResult {
  rows: ParsedChaseRow[];
  signFlipped: boolean;
  warnings: string[];
  periodStart: string | null;
  periodEnd: string | null;
  totalCents: number;
  fileSha256: string;
}

/** Chase writes MM/DD/YYYY. Returns ISO yyyy-mm-dd. */
export function parseChaseDate(input: string): string {
  const s = input.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  throw new Error(`Unparseable date: "${input}"`);
}

export function parseChaseCsv(content: string): ChaseParseResult {
  const warnings: string[] = [];
  const fileSha256 = createHash('sha256').update(content).digest('hex');

  const records = parse(content, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  interface Raw {
    postedDate: string; rawDescription: string; fileAmountCents: number;
    type: string; details: string;
  }
  const raw: Raw[] = [];

  records.forEach((rec, i) => {
    const line = i + 2;
    const dateStr = rec['Posting Date'] ?? rec['Transaction Date'] ?? rec['Date'];
    const desc = rec['Description'];
    const amountStr = rec['Amount'];

    if (!dateStr || !desc || !amountStr) {
      warnings.push(`Row ${line}: missing date, description, or amount — skipped.`);
      return;
    }

    let fileAmountCents: number;
    try {
      fileAmountCents = parseCents(amountStr);
    } catch {
      warnings.push(`Row ${line}: unparseable amount "${amountStr}" — skipped.`);
      return;
    }
    // The schema forbids zero-amount rows (CONSTRAINT amount_nonzero).
    if (fileAmountCents === 0) {
      warnings.push(`Row ${line}: zero amount — skipped.`);
      return;
    }

    let postedDate: string;
    try {
      postedDate = parseChaseDate(dateStr);
    } catch {
      warnings.push(`Row ${line}: unparseable date "${dateStr}" — skipped.`);
      return;
    }

    raw.push({
      postedDate,
      rawDescription: desc,
      fileAmountCents,
      type: rec['Type'] ?? '',
      details: (rec['Details'] ?? '').toUpperCase(),
    });
  });

  // Sign guard. Chase marks each row DEBIT or CREDIT in its own column, so the
  // file states its intent rather than leaving it to be inferred: a DEBIT that
  // is positive means the convention changed.
  const debits = raw.filter((r) => r.details === 'DEBIT');
  const positiveDebits = debits.filter((r) => r.fileAmountCents > 0).length;
  const signFlipped = debits.length > 0 && positiveDebits > debits.length / 2;

  if (signFlipped) {
    warnings.push(
      `Amount column is positive-for-debit (${positiveDebits}/${debits.length} DEBIT rows ` +
      `positive). Signs flipped so outflows are negative.`,
    );
  } else if (positiveDebits > 0) {
    warnings.push(
      `${positiveDebits} row(s) marked DEBIT have a positive amount. Check the preview.`,
    );
  }

  const rows: ParsedChaseRow[] = raw.map((r) => ({
    postedDate: r.postedDate,
    rawDescription: r.rawDescription,
    amountCents: signFlipped ? -r.fileAmountCents : r.fileAmountCents,
    type: r.type,
    details: r.details,
    status: 'posted' as TxnStatus,
  }));

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

/** Map to the canonical shape upsertTransactions() consumes. */
export function toCanonical(rows: ParsedChaseRow[], accountId: string): CanonicalTxn[] {
  return rows.map((r) => ({
    accountId,
    amountCents: r.amountCents,
    postedDate: r.postedDate,
    status: r.status,
    rawDescription: r.rawDescription,
    // No external_id: that absence is what lets a later API sync ADOPT these
    // rows rather than inserting a second copy (INGEST_NOTES.md §1).
    externalId: null,
    source: 'csv' as const,
  }));
}
