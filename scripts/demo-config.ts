/**
 * The demo ledger's fixed facts, shared by scripts/demo-db.ts and the
 * Playwright suites so the seed, the server and the test clock agree.
 */
export const DEMO_DB = 'finance_demo';
export const DEMO_PORT = '3001';
/** The date the demo ledger ends on. Fixed, so screenshots are comparable. */
export const SEED_TODAY = '2026-09-28';
