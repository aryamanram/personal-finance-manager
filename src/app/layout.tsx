import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { Inter_Tight, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Nav, NavLinks } from '@/components/Nav';
import { ThemeSwitch, type ThemeChoice } from '@/components/ThemeSwitch';
import { getReviewCounts } from '@/lib/queries';

// Fetched once at build time and served from this app. A stylesheet link to
// fonts.googleapis.com told Google the viewer's IP and when the ledger was
// open, on every page view. globals.css reads these through --font-sans/mono.
const sans = Inter_Tight({ subsets: ['latin'], display: 'swap', variable: '--font-inter-tight' });
const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  title: 'Ledger',
  description: 'Personal finance tracker',
};

/**
 * Flow first: where the month's money went is the question this ledger is
 * opened to answer. The wordmark is NOT a link — it and the first tab both
 * opened `/`, so the app read as two names for one page.
 */
const NAV = [
  { href: '/', label: 'Flow' },
  { href: '/review', label: 'Review' },
  { href: '/transactions', label: 'Register' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/setup', label: 'Setup' },
] as const;

/**
 * Everything outstanding — the number Review opens on (V3). A failure here
 * must not take every page down with it, so it degrades to no badge.
 */
async function outstanding(): Promise<number | undefined> {
  try {
    const c = await getReviewCounts();
    return c.needs_review + c.uncategorized;
  } catch {
    return undefined;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Pinned by the theme switch; absent means follow the system.
  const stored = (await cookies()).get('theme')?.value;
  const theme: ThemeChoice = stored === 'light' || stored === 'dark' ? stored : 'system';
  const toReview = await outstanding();
  const nav = NAV.map((item) => (item.href === '/review' ? { ...item, count: toReview } : item));

  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      data-theme={theme === 'system' ? undefined : theme}
    >
      {/* suppressHydrationWarning covers THIS element's attributes only, not
          its subtree, so a real mismatch anywhere inside still reports.
          Browser extensions inject attributes on <body> before React
          hydrates — cz-shortcut-listen, grammarly-*, data-lt-* — and each one
          logs a hydration error that no change to this app can prevent. */}
      <body className="min-h-screen bg-ground" suppressHydrationWarning>
        <Providers>
          <header className="rule-b sticky top-0 z-30 bg-ground/95 backdrop-blur">
            {/* On a phone the nav takes a row of its own and scrolls sideways,
                rather than pushing the whole page wider than the screen. */}
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5">
              <span className="text-[15px] font-semibold tracking-tight text-ink">ledger</span>
              {/* The nav reads the URL's period, which suspends on the server.
                  The fallback is the same links without it, so the header
                  never paints empty while the boundary resolves. */}
              <div className="order-last w-full sm:order-none sm:w-auto">
                <Suspense fallback={<NavLinks items={nav} period={null} />}>
                  <Nav items={nav} />
                </Suspense>
              </div>
              <div className="ml-auto">
                <ThemeSwitch initial={theme} />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
