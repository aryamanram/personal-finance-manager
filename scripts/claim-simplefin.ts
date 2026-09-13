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
    console.log('\nAccess URL claimed. Add this line to .env.local:\n');
    console.log(`SIMPLEFIN_ACCESS_URL=${url}\n`);
    console.log('This is a credential. .env.local is gitignored — keep it that way.');
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
