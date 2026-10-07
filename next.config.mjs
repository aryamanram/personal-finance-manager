import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Set by npm run dev:demo, which serves the synthetic ledger on :3001.
const demo = process.env.LEDGER_DEMO === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A stray package-lock.json above the repo makes Turbopack guess the wrong
  // workspace root. Pin it to this directory.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  // The demo builds into .next-demo, so the demo and the real app can run
  // side by side without sharing a build directory.
  distDir: demo ? '.next-demo' : '.next',
  experimental: {
    // `next dev` serves /_next/mcp — logs, routes, runtime errors — to any
    // agent that probes localhost, and next-devtools-mcp probes 3000–3010.
    // Only the demo answers: the real app's logs are about real money. Off
    // also stops the real app writing a dev log of its output under .next/.
    mcpServer: demo,
  },
};

export default nextConfig;
