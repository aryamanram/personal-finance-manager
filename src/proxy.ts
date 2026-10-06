/**
 * Runs before every page and API route (Next's proxy, formerly middleware).
 *
 * The rules live in lib/request-guard.ts, which says why they exist. This file
 * only reads the headers and turns a refusal into a response.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { allowedHosts, guardRequest } from './lib/request-guard';

const ALLOWED = allowedHosts(process.env.LEDGER_ALLOWED_HOSTS);

export function proxy(request: NextRequest) {
  const refused = guardRequest(
    {
      method: request.method,
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      origin: request.headers.get('origin'),
      secFetchSite: request.headers.get('sec-fetch-site'),
    },
    ALLOWED,
  );
  if (refused) {
    return new NextResponse(refused.reason, {
      status: refused.status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return NextResponse.next();
}

export const config = {
  // Everything except build assets, which are the same public code that is
  // on GitHub. Pages, their RSC payloads and every API route are covered.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
