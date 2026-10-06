/**
 * The ledger has no login, so the request guard is its access control.
 * Each case is a real request shape: the app's own traffic, which must pass,
 * and the two browser attacks a loopback bind does not stop, which must not.
 * See src/lib/request-guard.ts for the reasoning.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { guardRequest, allowedHosts, hostnameOf, type GuardInput } from '@/lib/request-guard';
import { proxy, config } from '@/proxy';

const LOCAL = allowedHosts(undefined);

const req = (over: Partial<GuardInput>): GuardInput => ({
  method: 'GET', host: 'localhost:3000', forwardedHost: null, origin: null, secFetchSite: null,
  ...over,
});

const status = (over: Partial<GuardInput>, allowed = LOCAL) => guardRequest(req(over), allowed)?.status ?? 200;

describe("the app's own traffic gets through", () => {
  it('a page load typed into the address bar', () => {
    expect(status({ secFetchSite: 'none' })).toBe(200);
  });

  it('an edit sent by the register', () => {
    expect(status({
      method: 'PATCH', origin: 'http://localhost:3000', secFetchSite: 'same-origin',
    })).toBe(200);
  });

  it('the same, reached as 127.0.0.1 or [::1]', () => {
    expect(status({ method: 'POST', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', secFetchSite: 'same-origin' })).toBe(200);
    expect(status({ method: 'POST', host: '[::1]:3000', origin: 'http://[::1]:3000', secFetchSite: 'same-origin' })).toBe(200);
  });

  it('a script or curl on this machine, which sends no browser headers', () => {
    expect(status({ method: 'POST' })).toBe(200);
  });
});

describe('DNS rebinding cannot read the ledger', () => {
  it('refuses a page whose hostname was re-pointed at 127.0.0.1', () => {
    // Same-origin from the browser's point of view — only Host gives it away.
    expect(status({ host: 'evil.example:3000', secFetchSite: 'same-origin' })).toBe(421);
  });

  it('is not fooled by a forwarded-host header the attacker set', () => {
    // A rebound page is same-origin to itself, so it may set any header.
    expect(status({ host: 'evil.example:3000', forwardedHost: 'localhost:3000' })).toBe(421);
  });

  it('refuses the machine\'s LAN address, even if the bind is ever widened', () => {
    expect(status({ host: '192.168.1.20:3000' })).toBe(421);
  });

  it('refuses a request with no Host at all', () => {
    expect(status({ host: null })).toBe(400);
  });
});

describe('another website cannot change the ledger', () => {
  it('refuses a cross-site form post', () => {
    expect(status({ method: 'POST', origin: 'https://evil.example', secFetchSite: 'cross-site' })).toBe(403);
  });

  it('refuses another app on localhost, whatever its port', () => {
    // Same SITE as the ledger (ports do not count), not the same origin.
    expect(status({ method: 'POST', origin: 'http://localhost:5173', secFetchSite: 'same-site' })).toBe(403);
  });

  it('checks Origin on its own, for a browser that sends no Sec-Fetch-Site', () => {
    expect(status({ method: 'DELETE', origin: 'https://evil.example' })).toBe(403);
  });

  it('refuses the opaque "null" origin of a sandboxed frame', () => {
    expect(status({ method: 'POST', origin: 'null' })).toBe(403);
  });
});

describe('a reverse proxy such as tailscale serve', () => {
  const tailnet = allowedHosts('ledger.tail1234.ts.net');
  const viaTailnet: Partial<GuardInput> = {
    method: 'POST', host: '127.0.0.1:3000', forwardedHost: 'ledger.tail1234.ts.net',
    origin: 'https://ledger.tail1234.ts.net', secFetchSite: 'same-origin',
  };

  it('is refused until its name is configured', () => {
    expect(status(viaTailnet)).toBe(421);
  });

  it('is allowed once LEDGER_ALLOWED_HOSTS names it', () => {
    expect(status(viaTailnet, tailnet)).toBe(200);
  });
});

describe('hostnameOf', () => {
  it('drops ports, brackets, schemes and case', () => {
    expect(hostnameOf('LocalHost:3000')).toBe('localhost');
    expect(hostnameOf('[::1]:3000')).toBe('::1');
    expect(hostnameOf('https://ledger.tail1234.ts.net:443/')).toBe('ledger.tail1234.ts.net');
  });

  it('rejects anything that is not a plain hostname', () => {
    expect(hostnameOf('localhost@evil.example')).toBeNull();
    expect(hostnameOf('')).toBeNull();
  });
});

describe('src/proxy.ts applies it', () => {
  it('runs on pages and every API route, and skips only build assets', () => {
    for (const url of ['/', '/transactions', '/api/transactions/bulk', '/api/income-sources/x']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
    expect(unstable_doesMiddlewareMatch({ config, url: '/_next/static/chunks/main.js' })).toBe(false);
  });

  it('turns a refusal into a response before any route runs', async () => {
    const attack = new NextRequest('http://localhost:3000/api/transactions/bulk', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(proxy(attack).status).toBe(403);

    const own = new NextRequest('http://localhost:3000/api/transactions/bulk', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
    });
    expect(proxy(own).status).toBe(200);
  });
});
