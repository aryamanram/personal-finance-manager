/**
 * Who sent an ACH credit, read out of the bank's description.
 *
 * The same deposit arrives in two shapes depending on the path it took:
 *
 *   CSV export   "ACME CORP        PAYROLL          PPD ID: 1234567890"
 *   feed         "ORIG CO NAME:ACME CORP CO ENTRY DESCR:PAYROLL SEC:PPD ORIG ID:1234567890"
 *
 * Both carry the NACHA originator ID — the company's own ACH identifier, which
 * does not change with the formatting, the entry description, or the path. It
 * is the most stable handle on "who paid me" that a bank description offers,
 * so an income source can be keyed on it rather than on the text around it.
 */

export interface AchPayer {
  /** Originating company name, as the bank printed it. */
  company: string;
  /** The ACH originator ID. Stable across formats. */
  originatorId: string;
}

const FEED_FORMAT =
  /ORIG CO NAME:\s*(.+?)\s+CO ENTRY DESCR:.*?ORIG ID:\s*([A-Z0-9]+)/i;

// "<company>  <entry descr>  PPD ID: <id>". The CSV pads fields with runs of
// spaces, which is the only reliable separator between company and entry
// description; a single-spaced string keeps both in `company`.
const EXPORT_FORMAT = /^(.*?)\s+(?:PPD|CCD|WEB|TEL|CTX)\s+ID:\s*([A-Z0-9]+)/i;

/** Reads the originating company and originator ID from an ACH description. */
export function parseAchPayer(raw: string): AchPayer | null {
  const feed = FEED_FORMAT.exec(raw);
  if (feed) return { company: feed[1].trim(), originatorId: feed[2] };

  const exp = EXPORT_FORMAT.exec(raw);
  if (exp) {
    const company = exp[1].split(/\s{2,}/)[0].trim();
    if (company) return { company, originatorId: exp[2] };
  }
  return null;
}
