/**
 * One-time SimpleFIN setup: exchange a setup token for a durable access URL.
 *
 *   npx tsx scripts/claim-simplefin.ts <setup-token>
 *
 * Get a token at https://beta-bridge.simplefin.org/. The token is single-use;
 * a 403 means it was already claimed, which per the protocol checklist may mean
 * it was compromised — revoke it at the bridge rather than retrying.
 *
 * The access URL it prints is a BEARER CREDENTIAL. It goes in .env.local, which
 * is gitignored. Never commit it, never paste it into an issue.
 */
import { claimAccessUrl } from '../src/ingest/simplefin.js';

const token = process.argv[2];
if (!token) {
  console.error('Usage: npx tsx scripts/claim-simplefin.ts <setup-token>');
  process.exit(1);
}

claimAccessUrl(token)
  .then((url) => {
    // The bridge may hand back either bridge.simplefin.org or
    // beta-bridge.simplefin.org. Both are valid; use whatever it returned.
    let host = '(unparseable)';
    let hasCredentials = false;
    try {
      const parsed = new URL(url);
      host = parsed.host;
      hasCredentials = Boolean(parsed.username && parsed.password);
    } catch {
      /* reported below */
    }

    console.log('\nAccess URL claimed.\n');
    console.log(`  host         ${host}`);
    console.log(`  credentials  ${hasCredentials ? 'embedded (expected)' : 'MISSING — see below'}`);

    if (!hasCredentials) {
      console.log(
        '\n! The URL has no user:password@ part. A URL without embedded\n' +
        '  credentials will fail with 403 on the first sync. Check that the\n' +
        '  whole token was pasted, then claim a fresh one — this one is spent.',
      );
    }

    console.log('\nAdd this line to .env.local, on ONE line with no quotes:\n');
    console.log(`SIMPLEFIN_ACCESS_URL=${url}\n`);
    console.log('This is a bearer credential. .env.local is gitignored — keep it that way.');
    console.log('Then run:  npm run sync');
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
