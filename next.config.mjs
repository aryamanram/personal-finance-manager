import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A stray package-lock.json above the repo makes Turbopack guess the wrong
  // workspace root. Pin it to this directory.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  // npm run dev:demo builds into .next-demo, so the demo and the real app can
  // run side by side without sharing a build directory.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
