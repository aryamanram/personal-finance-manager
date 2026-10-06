/**
 * Give the database role a new random password, and DATABASE_URL with it.
 *
 *   npm run db:rotate-password                     # .env.local
 *   npm run db:rotate-password -- --env-file <path>
 *
 * docker-compose.yml sets POSTGRES_PASSWORD to a default that is printed in
 * this public repo. It only applies when the volume is first created, so a
 * real ledger should rotate away from it once — after which the compose value
 * is inert.
 *
 * The role and the env file must change together: either one alone leaves the
 * app unable to connect. So this changes the role, PROVES the new password by
 * opening a fresh connection with it, and only then rewrites the file. If
 * anything fails in between, the role is put back. The password is never
 * printed.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import postgres from 'postgres';
import { parse } from 'dotenv';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const envFile = arg('env-file') ?? '.env.local';

/** A connection that proves the credentials work, then closes. */
async function canConnect(url: string): Promise<boolean> {
  const probe = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  try {
    await probe`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 });
  }
}

async function main() {
  // Read the file this script will rewrite, not process.env: the URL that
  // changes must be the one the app actually loads.
  const text = readFileSync(envFile, 'utf8');
  const current = parse(text).DATABASE_URL;
  if (!current) throw new Error(`${envFile} has no DATABASE_URL line to update.`);

  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^\s*(export\s+)?DATABASE_URL\s*=/.test(l));
  if (at < 0 || lines.filter((l) => /^\s*(export\s+)?DATABASE_URL\s*=/.test(l)).length !== 1) {
    throw new Error(`${envFile} must define DATABASE_URL exactly once.`);
  }

  const url = new URL(current);
  const role = decodeURIComponent(url.username);
  const oldPassword = decodeURIComponent(url.password);
  if (!role) throw new Error('DATABASE_URL names no role.');

  // base64url: letters, digits, '-' and '_' only, so it needs no escaping in
  // a SQL literal or a URL.
  const next = randomBytes(24).toString('base64url');
  const nextUrl = new URL(current);
  nextUrl.password = next;

  const quotedRole = `"${role.replace(/"/g, '""')}"`;
  const literal = (p: string) => `'${p.replace(/'/g, "''")}'`;

  // One session, opened with the OLD password and held for the whole run. An
  // established session survives a password change, which is what makes
  // putting the role back possible if anything below fails.
  const admin = postgres(current, { max: 1, onnotice: () => {} });
  const restore = () => admin.unsafe(`ALTER ROLE ${quotedRole} PASSWORD ${literal(oldPassword)}`);

  try {
    await admin`SELECT 1`;
    // A utility statement takes no bind parameters; the value is base64url.
    await admin.unsafe(`ALTER ROLE ${quotedRole} PASSWORD ${literal(next)}`);

    if (!(await canConnect(nextUrl.toString()))) {
      await restore();
      throw new Error('The new password did not authenticate. The role was put back; nothing changed.');
    }
    // The other half of the proof. If the old password still gets in, the
    // server is not checking passwords on this path (trust auth), and a
    // rotation would protect nothing.
    if (await canConnect(current)) {
      await restore();
      throw new Error('The server accepted the OLD password too, so it is not checking passwords on this connection. Nothing changed.');
    }

    try {
      // Atomic replace, keeping the file's permissions.
      lines[at] = `DATABASE_URL=${nextUrl.toString()}`;
      const tmp = `${envFile}.rotating`;
      writeFileSync(tmp, lines.join('\n'), { mode: statSync(envFile).mode & 0o777 });
      renameSync(tmp, envFile);
    } catch (err) {
      await restore();
      throw new Error(`Could not rewrite ${envFile}; the role was put back. ${err instanceof Error ? err.message : err}`);
    }
  } finally {
    await admin.end({ timeout: 1 });
  }

  console.log(`✓ new password set for role "${role}" and written to ${envFile}`);
  console.log('  Restart anything already running (npm run dev) so it reconnects with it.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
