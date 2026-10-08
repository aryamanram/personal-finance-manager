import { execFileSync } from 'node:child_process';

/** Only the seed writes this; no real ledger has it. */
const SYNTHETIC_MARKER = 'ACME CORP PAYROLL';

/**
 * Runs once, after Playwright has started (or found) the server on :3001.
 *
 * Reseeds first: clicking through the demo edits it, and a screenshot of
 * yesterday's edits is not a regression. Then checks that the server really
 * is showing the synthetic ledger — the baselines go into a public repo, so
 * a real ledger answering on :3001 must stop the run, not be photographed.
 */
export default async function globalSetup() {
  execFileSync('npm', ['run', '--silent', 'demo:reseed'], { stdio: 'inherit' });

  const res = await fetch('http://127.0.0.1:3001/transactions');
  const html = await res.text();
  if (!res.ok || !html.includes(SYNTHETIC_MARKER)) {
    throw new Error(
      `Refusing to run: the server on 127.0.0.1:3001 (HTTP ${res.status}) is not showing the demo ledger. ` +
      'If dev:demo was running when you ran demo:setup, restart it; otherwise stop whatever is ' +
      'on :3001 and let Playwright start npm run dev:demo.',
    );
  }
}
