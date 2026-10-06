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
 *   1. take a lock, so two runs cannot undo each other
 *   2. write the new env file beside the old one as `<env>.rotate-pending`,
 *      private and flushed to disk — the recovery record if this process dies
 *   3. change the role, through a session opened with the old password
 *   4. prove it: the new password connects AND the old one is refused
 *   5. rename the pending file over the env file, and flush the directory
 *
 * A failure in 3–5 puts the role back. A crash leaves the lock and the pending
 * file; the next run sees the lock's process is gone, keeps whichever URL
 * actually connects, and finishes or starts over. The password is never
 * printed.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import postgres from 'postgres';
import { parse } from 'dotenv';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const envFile = arg('env-file') ?? '.env.local';
const lockFile = `${envFile}.rotate-lock`;
const pendingFile = `${envFile}.rotate-pending`;

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

/** Creates `path` exclusively — never reusing a file, or its permissions. */
function writeNew(path: string, content: string) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** A rename is only durable once its directory entry is. */
function syncDir(path: string) {
  const fd = openSync(dirname(path), 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function unlinkIfThere(path: string) {
  if (existsSync(path)) unlinkSync(path);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists, it is just not ours to signal.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readUrl(path: string): string {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter((l) => /^\s*(export\s+)?DATABASE_URL\s*=/.test(l));
  const url = parse(text).DATABASE_URL;
  if (!url || lines.length !== 1) throw new Error(`${path} must define DATABASE_URL exactly once.`);
  return url;
}

/**
 * Takes the lock. A lock left by a process that is gone means a rotation died
 * part-way; resolve it first. Returns true if that resolution already
 * finished the job.
 */
async function acquireLock(): Promise<boolean> {
  try {
    writeNew(lockFile, String(process.pid));
    return false;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }

  const holder = Number(readFileSync(lockFile, 'utf8').trim());
  if (Number.isInteger(holder) && holder > 0 && isRunning(holder)) {
    throw new Error(`Another rotation (pid ${holder}) is running. Nothing changed.`);
  }

  // The dead run's pending file is right exactly when the role already has
  // its password — i.e. it got past step 3. Then finishing is just step 5.
  if (existsSync(pendingFile) && (await canConnect(readUrl(pendingFile)))) {
    renameSync(pendingFile, envFile);
    syncDir(envFile);
    unlinkSync(lockFile);
    return true;
  }
  // Otherwise it never changed the role: discard its leftovers and start over.
  unlinkIfThere(pendingFile);
  unlinkSync(lockFile);
  writeNew(lockFile, String(process.pid));
  return false;
}

async function rotate() {
  const text = readFileSync(envFile, 'utf8');
  const current = readUrl(envFile);
  const url = new URL(current);
  const role = decodeURIComponent(url.username);
  const oldPassword = decodeURIComponent(url.password);
  if (!role) throw new Error('DATABASE_URL names no role.');

  // base64url: letters, digits, '-' and '_' only, so it needs no escaping in
  // a SQL literal or a URL.
  const next = randomBytes(24).toString('base64url');
  const nextUrl = new URL(current);
  nextUrl.password = next;

  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^\s*(export\s+)?DATABASE_URL\s*=/.test(l));
  lines[at] = `DATABASE_URL=${nextUrl.toString()}`;
  writeNew(pendingFile, lines.join('\n'));

  const quotedRole = `"${role.replace(/"/g, '""')}"`;
  const literal = (p: string) => `'${p.replace(/'/g, "''")}'`;

  // One session, opened with the OLD password and held for the whole run. An
  // established session survives a password change, which is what makes
  // putting the role back possible if anything below fails.
  const admin = postgres(current, { max: 1, onnotice: () => {} });
  const putBack = async (why: string): Promise<never> => {
    await admin.unsafe(`ALTER ROLE ${quotedRole} PASSWORD ${literal(oldPassword)}`);
    unlinkIfThere(pendingFile);
    throw new Error(`${why} The role was put back; nothing changed.`);
  };

  try {
    try {
      await admin`SELECT 1`;
    } catch (e) {
      unlinkIfThere(pendingFile);
      throw e;
    }
    // A utility statement takes no bind parameters; the value is base64url.
    await admin.unsafe(`ALTER ROLE ${quotedRole} PASSWORD ${literal(next)}`);

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
      syncDir(envFile);
    } catch (err) {
      await putBack(`Could not replace ${envFile}: ${err instanceof Error ? err.message : err}.`);
    }
  } finally {
    await admin.end({ timeout: 1 });
  }
  return role;
}

async function main() {
  if (await acquireLock()) {
    console.log(`✓ finished a rotation that was interrupted; ${envFile} matches the role again`);
    return;
  }
  try {
    const role = await rotate();
    console.log(`✓ new password set for role "${role}" and written to ${envFile}`);
    console.log('  Restart anything already running (npm run dev) so it reconnects with it.');
  } finally {
    unlinkIfThere(lockFile);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
