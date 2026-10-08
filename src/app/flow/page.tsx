// The Flow moved to `/`, where it is the first page. Its old address renders
// the same page rather than redirecting: the app has no redirect taken from a
// request, and the Playwright allowlist depends on that (V7).
export const dynamic = 'force-dynamic';
export { default } from '../page';
