import { config } from 'dotenv';

let loaded = false;

/** Loads .env.local then .env once per process. Next loads these itself in the
 *  app; scripts and tests need this explicitly. */
export function loadEnv() {
  if (loaded) return;
  config({ path: '.env.local', quiet: true });
  config({ path: '.env', quiet: true });
  loaded = true;
}
