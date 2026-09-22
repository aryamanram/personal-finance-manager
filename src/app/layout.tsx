import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Ledger',
  description: 'Personal finance tracker',
};

const NAV = [
  { href: '/', label: 'Cashflow' },
  { href: '/flow', label: 'Flow' },
  { href: '/transactions', label: 'Register' },
  { href: '/accounts', label: 'Accounts' },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-ink-900">
        <Providers>
          <header className="rule-b sticky top-0 z-30 bg-ink-900/95 backdrop-blur">
            <div className="mx-auto flex max-w-[1400px] items-baseline gap-8 px-6 py-4">
              <Link href="/" className="figure text-sm font-semibold tracking-tight text-paper">
                ledger
              </Link>
              <Nav items={NAV} />
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
