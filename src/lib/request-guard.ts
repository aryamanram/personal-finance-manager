/**
 * Who may talk to the ledger at all.
 *
 * There is no login (DESIGN.md §1: one person, localhost or Tailscale), so the
 * network boundary IS the access control. The server binds to loopback, which
 * keeps other machines out — but not other WEBSITES, because the browser on
 * this machine is already inside the boundary. Two well-worn attacks use it:
 *
 *   DNS rebinding   A page on evil.example re-points its own hostname at
 *                   127.0.0.1, then reads http://evil.example:3000/ — the whole
 *                   ledger — as same-origin. The only tell is the Host header,
 *                   which still says evil.example.
 *   Cross-site write  Any page can POST to http://localhost:3000/api/… without
 *                   a CORS preflight (a form, or fetch with a text/plain body),
 *                   and the routes read the body whatever its content type.
 *
 * So: the Host must be a name this ledger answers to, and a state-changing
 * request a browser sends must come from the ledger's own pages. Requests with
 * no browser provenance headers at all (curl, scripts) are allowed — anything
 * able to send those is already running on this machine.
 *
 * Pure, so tests drive it directly; src/proxy.ts applies it to every request.
 */

/** Names the ledger answers to with no configuration. */
const LOOPBACK = ['localhost', '127.0.0.1', '::1'];

/** Methods that never change state here, so provenance does not matter. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface GuardInput {
  method: string;
  /**
   * The scheme the BROWSER used: 'http' or 'https'. Behind a TLS-terminating
   * proxy that is X-Forwarded-Proto, not the scheme this server listens on.
   */
  protocol: string;
  host: string | null;
  /** Set by a reverse proxy in front of the app, e.g. `tailscale serve`. */
  forwardedHost?: string | null;
  origin: string | null;
  secFetchSite: string | null;
}

export interface Rejection {
  status: number;
  reason: string;
}

/**
 * Hostnames allowed beyond loopback, from LEDGER_ALLOWED_HOSTS
 * ("ledger.tailnet-name.ts.net,other.example"). Ports and schemes are ignored.
 */
export function allowedHosts(extra: string | undefined): string[] {
  const added = (extra ?? '')
    .split(',')
    .map((h) => hostnameOf(h.trim()))
    .filter((h): h is string => h !== null);
  return [...LOOPBACK, ...added];
}

/** null to let the request through, or why it was refused. */
export function guardRequest(req: GuardInput, allowed: readonly string[]): Rejection | null {
  const hosts = [req.host, req.forwardedHost].filter((h): h is string => !!h);
  if (!req.host) return { status: 400, reason: 'Missing Host header.' };

  // Every host the request claims must be ours. Checking the forwarded one
  // ALONE would undo the rebinding defence: a rebound page is same-origin to
  // itself, so it can set X-Forwarded-Host to anything it likes.
  for (const h of hosts) {
    const name = hostnameOf(h);
    if (!name || !allowed.includes(name)) {
      return { status: 421, reason: `This ledger does not answer to "${h}".` };
    }
  }

  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;

  // Sent by every current browser on every request. 'none' is a user typing
  // the URL or using a bookmark; 'same-site' would admit any other app on
  // localhost, whatever its port, so it is not enough.
  if (req.secFetchSite && req.secFetchSite !== 'same-origin' && req.secFetchSite !== 'none') {
    return { status: 403, reason: 'Cross-site request refused.' };
  }

  if (req.origin !== null) {
    let origin: string;
    try {
      origin = new URL(req.origin).origin;
    } catch {
      // Includes the literal "null" a sandboxed frame or file:// page sends.
      return { status: 403, reason: 'Unreadable Origin refused.' };
    }
    // The whole origin — scheme, host AND port. Comparing hosts alone let an
    // http:// page post to the https:// ledger on the same name.
    const scheme = req.protocol.split(',')[0].trim().replace(/:$/, '').toLowerCase();
    const ours = hosts.map((h) => originOf(scheme, h));
    if (!ours.includes(origin)) {
      return { status: 403, reason: 'Cross-origin request refused.' };
    }
  }

  return null;
}

/** The canonical origin a page served at scheme://host would send, or null. */
function originOf(scheme: string, host: string): string | null {
  try {
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * The hostname of a Host header or a bare name: port and brackets removed,
 * lowercased. "[::1]:3000" → "::1", "LocalHost:3000" → "localhost".
 */
export function hostnameOf(value: string): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracketed) return bracketed[1];
  // An unbracketed IPv6 literal has several colons and no port to strip.
  if ((v.match(/:/g) ?? []).length > 1) return v;
  const name = v.replace(/:\d+$/, '');
  return /^[a-z0-9.-]+$/.test(name) ? name : null;
}
