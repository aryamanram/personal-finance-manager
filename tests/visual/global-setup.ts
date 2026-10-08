import { execFileSync } from 'node:child_process';
import { DEMO_DB, DEMO_PORT } from '../../scripts/demo-config';

const DEMO = `http://127.0.0.1:${DEMO_PORT}`;

/** Only the seed writes this; no real ledger has it. */
const SYNTHETIC_MARKER = 'ACME CORP PAYROLL';

function refuse(why: string): never {
  throw new Error(
    `Refusing to run: ${why}. The baselines go into a public repo. If dev:demo was running ` +
    'when you ran demo:setup, restart it; otherwise stop whatever is on ' +
    `:${DEMO_PORT} and let Playwright start npm run dev:demo.`,
  );
}

/**
 * Runs once, after Playwright has started (or found) the server on :3001.
 *
 * Reseeds first: clicking through the demo edits it, and a screenshot of
 * yesterday's edits is not a regression. Then makes the server prove what it
 * is reading — from its own database connection, not from what a page looks
 * like — and checks the page really shows the synthetic ledger. Redirects
 * are refused, not followed: an answer from somewhere else proves nothing.
 */
export default async function globalSetup() {
  execFileSync('npm', ['run', '--silent', 'demo:reseed'], { stdio: 'inherit' });

  const attest = await fetch(`${DEMO}/api/demo`, { redirect: 'manual' });
  const database = attest.status === 200 ? ((await attest.json()) as { database?: string }).database : undefined;
  if (database !== DEMO_DB) {
    refuse(`the server on :${DEMO_PORT} is not a demo server reading ${DEMO_DB} ` +
      `(GET /api/demo: HTTP ${attest.status}${database ? `, reading ${database}` : ''})`);
  }

  const page = await fetch(`${DEMO}/transactions`, { redirect: 'manual' });
  if (page.status !== 200 || !(await page.text()).includes(SYNTHETIC_MARKER)) {
    refuse(`the register on :${DEMO_PORT} (HTTP ${page.status}) is not showing the synthetic ledger`);
  }
}
