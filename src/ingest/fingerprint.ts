/**
 * Fingerprinting for re-import-safe dedup (INGEST_NOTES.md §1).
 *
 *   fingerprint = sha256(account_id | posted_date | amount_cents | normalize(raw_description))
 *
 * normalize() must be STABLE. Changing it invalidates every stored fingerprint
 * and will cause a re-import to double-count. If you change it, re-fingerprint
 * the whole table in the same migration.
 */
import { createHash } from 'node:crypto';

/**
 * Noise that churns between a pending and a posted description, or between two
 * statements for the same merchant. Applied to the RAW string, before
 * punctuation is stripped, because the markers ("#", "REF:") are punctuation.
 */
const NOISE = [
  /#\s*\d+/g,                              // "STARBUCKS #12345"
  /\b(?:AUTH|REF|TRACE|SEQ|ID)\s*[#:]?\s*[A-Z0-9]{4,}\b/gi,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,    // embedded date "UBER TRIP 08/14"
  /\b\d{5,}\b/g,                           // bare store / ref numbers
];

/** Payment-processor prefixes: "SQ *BLUE BOTTLE". */
const LEADING_NOISE = [
  /^(?:SQ|TST|SP|PY|PAYPAL|IC)\s*\*\s*/i,
  /^(?:POS|ACH|DEBIT|CREDIT|CHECKCARD|PURCHASE)\s+(?:DEBIT\s+)?/i,
  /^RECURRING\s+(?:PAYMENT|CARD)\s+/i,
];

/** Trailing tokens stripped only after the string is alphanumeric. */
const TRAILING_NOISE = [
  /\s+[A-Z]{2}$/,        // trailing state code: "... SEATTLE WA"
  /\s+\d+$/,             // any leftover trailing number
];

/** US state codes — only these are stripped as a trailing location token, so a
 *  genuine two-letter merchant suffix is not eaten. */
const STATE_CODES = new Set(
  ('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO ' +
   'MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC')
    .split(' '),
);

/**
 * Uppercase, strip punctuation, collapse whitespace, remove store numbers and
 * transaction refs. Used for BOTH the fingerprint and merchant matching, so it
 * must be deterministic and side-effect free.
 *
 * STABILITY WARNING: changing this invalidates every stored fingerprint. If you
 * change it, re-fingerprint the whole table in the same migration or the next
 * import will double-count.
 */
export function normalize(raw: string): string {
  let s = raw.normalize('NFKD').toUpperCase();

  for (const re of LEADING_NOISE) s = s.replace(re, '');
  // Noise patterns run against raw punctuation ("#12345", "REF: AB12").
  for (const re of NOISE) s = s.replace(re, ' ');

  s = s.replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

  // Trailing noise can nest ("STARBUCKS 123 CA"), so strip repeatedly.
  let previous: string;
  do {
    previous = s;
    for (const re of TRAILING_NOISE) {
      const m = re.exec(s);
      if (!m) continue;
      const token = m[0].trim();
      // Only drop a two-letter token when it is actually a state code.
      if (/^[A-Z]{2}$/.test(token) && !STATE_CODES.has(token)) continue;
      s = s.slice(0, m.index).trim();
    }
  } while (s !== previous && s.length > 0);

  return s;
}

/**
 * Merchant key: normalize() plus a few merchant-specific collapses that are
 * WRONG for fingerprinting (they'd merge distinct transactions) but right for
 * grouping a payee. Kept separate from normalize() on purpose.
 */
export function merchantKey(raw: string): string {
  let s = normalize(raw);
  s = s.replace(/\s+(?:INC|LLC|CO|CORP|LTD|COM)$/g, '').trim();
  return s.toLowerCase();
}

/** Title-cased display form of a merchant key. */
export function merchantDisplayName(key: string): string {
  return key
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export interface FingerprintInput {
  accountId: string;
  postedDate: string;   // ISO yyyy-mm-dd
  amountCents: number;
  rawDescription: string;
}

export function fingerprint({
  accountId,
  postedDate,
  amountCents,
  rawDescription,
}: FingerprintInput): string {
  const parts = [accountId, postedDate, String(amountCents), normalize(rawDescription)];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
