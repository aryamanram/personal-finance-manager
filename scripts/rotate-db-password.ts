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
 * app unable to connect. So, in order:
 *
 *   1. connect with the env file's URL and take a Postgres advisory lock on
 *      that session. Two runs cannot interleave, and a run that dies releases
 *      the lock with its connection — there is no lock file to go stale.
 *   2. settle anything an earlier run left in `<env>.rotate-pending`, by proof
 *      alone: if ITS url is the one that connects, that run had changed the
 *      role, so install it; if the env file's url connects, it had not, so
 *      discard it; if neither does, stop and keep it.
 *   3. write the new env file as `<env>.rotate-pending` — created exclusively,
 *      0600, flushed along with its directory. If this run dies, that file is
 *      the only copy of the new password, and step 2 of the next run uses it.
 *   4. change the role through the locked session; prove the new password
 *      connects AND the old one is refused.
 *   5. rename the pending file over the env file.
 *
 * A failure in 4–5 puts the role back and removes the pending file; if even
 * that fails, the pending file stays for the next run to settle. The password
 * is never printed.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { parse } from 'dotenv';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const envFile = arg('env-file') ?? '.env.local';
const pendingFile = `${envFile}.rotate-pending`;
/** Arbitrary, fixed: every run of this script contends for the same lock. */
const LOCK_KEY = 7270331502;

/** An open session with these credentials, or null if they do not get in. */
async function open(url: string): Promise<Sql | null> {
  const s = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  try {
    await s`SELECT 1`;
    return s;
  } catch {
    await s.end({ timeout: 1 });
    return null;
  }
}

async function canConnect(url: string): Promise<boolean> {
  const s = await open(url);
  if (s) await s.end({ timeout: 1 });
  return s !== null;
}

/**
 * Creates `path` exclusively — never reusing a file or its permissions — and
 * flushes it. A file this call created but could not finish is removed; one
 * that already existed is never touched.
 */
function writeNew(path: string, content: string) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    unlinkSync(path);
    throw e;
  }
  closeSync(fd);
}

/** A file's creation or rename is only durable once its directory is. */
function syncDir(path: string) {
  const fd = openSync(dirname(path), 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function unlinkIfThere(path: string) {
  if (existsSync(path)) unlinkSync(path);
}

function readUrl(path: string): string {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter((l) => /^\s*(export\s+)?DATABASE_URL\s*=/.test(l));
  const url = parse(text).DATABASE_URL;
  if (!url || lines.length !== 1) throw new Error(`${path} must define DATABASE_URL exactly once.`);
  return url;
}

function tryReadUrl(path: string): string | null {
  try { return readUrl(path); } catch { return null; }
}

async function rotate(admin: Sql, current: string): Promise<string> {
  const url = new URL(current);
  const role = decodeURIComponent(url.username);
  const oldPassword = decodeURIComponent(url.password);
  if (!role) throw new Error('DATABASE_URL names no role.');

  // base64url: letters, digits, '-' and '_' only, so it needs no escaping in
  // a SQL literal or a URL.
  const next = randomBytes(24).toString('base64url');
  const nextUrl = new URL(current);
  nextUrl.password = next;

  const lines = readFileSync(envFile, 'utf8').split('\n');
  const at = lines.findIndex((l) => /^\s*(export\s+)?DATABASE_URL\s*=/.test(l));
  lines[at] = `DATABASE_URL=${nextUrl.toString()}`;
  writeNew(pendingFile, lines.join('\n'));
  syncDir(pendingFile);

  const quotedRole = `"${role.replace(/"/g, '""')}"`;
  const literal = (p: string) => `'${p.replace(/'/g, "''")}'`;

  // The admin session was opened with the OLD password, and an established
  // session survives a password change — that is what makes this possible.
  const putBack = async (why: string): Promise<never> => {
    try {
      await admin.unsafe(`ALTER ROLE ${quotedRole} PASSWORD ${literal(oldPassword)}`);
    } catch (e) {
      throw new Error(
        `${why} Putting the role back failed too (${e instanceof Error ? e.message : e}). ` +
        `${pendingFile} holds the password the role now has: run this again to install it.`,
      );
    }
    unlinkIfThere(pendingFile);
    throw new Error(`${why} The role was put back; nothing changed.`);
  };

  try {
    // A utility statement takes no bind parameters; the value is base64url.
    await admin.unsafe(`ALTER ROLE ${quotedRole} PASSWORD ${literal(next)}`);
  } catch (e) {
    unlinkIfThere(pendingFile);
    throw e;
  }

  if (!(await canConnect(nextUrl.toString()))) {
    await putBack('The new password did not authenticate.');
  }
  // The other half of the proof. If the old password still gets in, the
  // server is not checking passwords on this path (trust auth), and a
  // rotation would protect nothing.
  if (await canConnect(current)) {
    await putBack('The server accepted the OLD password too, so it is not checking passwords on this connection.');
  }

  try {
    renameSync(pendingFile, envFile);
  } catch (err) {
    await putBack(`Could not replace ${envFile}: ${err instanceof Error ? err.message : err}.`);
  }
  // From here the env file and the role agree. A failed flush only risks a
  // power cut undoing the rename — never a reason to change the role again.
  try {
    syncDir(envFile);
  } catch (err) {
    console.warn(`! ${envFile} is replaced, but flushing its directory failed: ${err instanceof Error ? err.message : err}`);
  }
  return role;
}

async function main() {
  const current = readUrl(envFile);
  const pending = existsSync(pendingFile) ? tryReadUrl(pendingFile) : null;

  // Whichever password the role actually has. The env file's first, so a
  // pending URL is only used when it is the one that works.
  let session = await open(current);
  let viaPending = false;
  if (!session && pending) {
    session = await open(pending);
    viaPending = session !== null;
  }
  if (!session) {
    throw new Error(
      existsSync(pendingFile)
        ? `Neither ${envFile} nor ${pendingFile} connects. Is the database running? Both files kept; nothing changed.`
        : `${envFile} does not connect. Is the database running? Nothing changed.`,
    );
  }

  try {
    const [{ locked }] = await session<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${LOCK_KEY}::bigint) AS locked`;
    if (!locked) throw new Error('Another rotation is running. Nothing changed.');
    // Re-read under the lock: a run that finished while this one connected
    // may already have rewritten the file.
    if (readUrl(envFile) !== current) {
      throw new Error(`${envFile} changed while this run was starting. Run it again.`);
    }

    if (existsSync(pendingFile)) {
      if (viaPending) {
        renameSync(pendingFile, envFile);
        syncDir(envFile);
        console.log(`✓ finished a rotation that was interrupted; ${envFile} matches the role again`);
        return;
      }
      // The env file's URL got in, so the role never took the pending one.
      unlinkSync(pendingFile);
    }

    const role = await rotate(session, current);
    console.log(`✓ new password set for role "${role}" and written to ${envFile}`);
    console.log('  Restart anything already running (npm run dev) so it reconnects with it.');
  } finally {
    // Ends the session, which releases the advisory lock.
    await session.end({ timeout: 1 });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
