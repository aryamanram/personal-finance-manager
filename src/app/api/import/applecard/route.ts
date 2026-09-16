/**
 * Apple Card CSV import (DESIGN.md §6).
 *
 * Two-phase by design: POST with commit=false returns a parsed preview and
 * writes NOTHING. The user confirms, then commit=true writes. Never write on
 * drop — an unreviewed statement with a flipped sign convention silently
 * inverts a month.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { parseAppleCardCsv, toCanonical } from '@/ingest/applecard-csv';
import { upsertTransactions } from '@/ingest/upsert';
import { runCategorization } from '@/categorize/run';
import { matchTransfers } from '@/transfers/match';
import { formatTimestampShort } from '@/lib/format-date';

export const maxDuration = 60;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 });

  const file = form.get('file');
  const accountId = String(form.get('account_id') ?? '');
  const commit = String(form.get('commit') ?? '') === 'true';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (!accountId) {
    return NextResponse.json({ error: 'Choose an account to import into.' }, { status: 400 });
  }

  const content = await file.text();

  let parsed;
  try {
    parsed = parseAppleCardCsv(content);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not parse the file: ${err instanceof Error ? err.message : err}` },
      { status: 400 },
    );
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: 'No usable rows found.', warnings: parsed.warnings },
      { status: 400 },
    );
  }

  // Has this exact file already been imported successfully?
  const [priorImport] = await sql<{ id: string; started_at: Date; rows_inserted: number }[]>`
    SELECT id, started_at, rows_inserted FROM import_batches
    WHERE account_id = ${accountId} AND file_sha256 = ${parsed.fileSha256} AND status = 'ok'
    LIMIT 1`;

  if (!commit) {
    return NextResponse.json({
      preview: {
        rowCount: parsed.rows.length,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        totalCents: parsed.totalCents,
        signFlipped: parsed.signFlipped,
        warnings: parsed.warnings,
        alreadyImported: priorImport
          ? { at: priorImport.started_at, rowsInserted: priorImport.rows_inserted }
          : null,
        rows: parsed.rows.slice(0, 40),
      },
    });
  }

  // import_batches carries a unique index on (account_id, file_sha256) where
  // status='ok'. Re-importing the same file is a legitimate thing to do — it
  // must report "nothing to do", not surface a constraint violation. The row
  // count is protected by counting dedup regardless (I7).
  if (priorImport) {
    return NextResponse.json({
      imported: {
        inserted: 0,
        duplicate: parsed.rows.length,
        adopted: 0,
        categorized: 0,
        transfersLinked: 0,
        warnings: [
          `This file was already imported on ` +
          `${formatTimestampShort(priorImport.started_at)}. Nothing to do.`,
        ],
      },
    });
  }

  const [batch] = await sql<{ id: string }[]>`
    INSERT INTO import_batches
      (account_id, source, filename, file_sha256, period_start, period_end, rows_seen)
    VALUES (${accountId}, 'csv', ${file.name}, ${parsed.fileSha256},
            ${parsed.periodStart}, ${parsed.periodEnd}, ${parsed.rows.length})
    RETURNING id`;

  try {
    // Counting dedup makes a re-import a no-op regardless of the file hash,
    // so re-importing an overlapping statement is safe (I7).
    const result = await upsertTransactions(
      sql,
      toCanonical(parsed.rows, accountId),
      { importBatchId: batch.id },
    );

    await sql`
      UPDATE import_batches SET
        status = 'ok', finished_at = now(),
        rows_inserted = ${result.inserted}, rows_duplicate = ${result.duplicate}
      WHERE id = ${batch.id}`;

    // Categorize and re-run the transfer matcher — the Apple Card syncs monthly
    // by file, so its half of a payment pair only appears now.
    const categorized = await runCategorization(sql, { noLlm: !process.env.ANTHROPIC_API_KEY });
    const transfers = await matchTransfers(sql);

    return NextResponse.json({
      imported: {
        inserted: result.inserted,
        duplicate: result.duplicate,
        adopted: result.adopted,
        categorized: categorized.byRule + categorized.byLlm,
        transfersLinked: transfers.linked,
        warnings: parsed.warnings,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE import_batches SET status = 'failed', finished_at = now(), error = ${message}
      WHERE id = ${batch.id}`;
    console.error('CSV import failed:', err);
    return NextResponse.json({ error: `Import failed: ${message}` }, { status: 500 });
  }
}
