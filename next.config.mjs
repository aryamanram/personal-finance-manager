import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A stray package-lock.json above the repo makes Turbopack guess the wrong
  // workspace root. Pin it to this directory.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
