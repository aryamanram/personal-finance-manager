/** Loads .env.local then .env, without overriding already-set process env. */
import { config } from 'dotenv';

export function loadEnv() {
  config({ path: '.env.local', quiet: true });
  config({ path: '.env', quiet: true });
}
