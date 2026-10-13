'use client';

import { Suspense, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { Inbox, Landmark, Menu, Rows3, Settings2, Split, X, type LucideIcon } from 'lucide-react';
import { ThemeSwitch, type ThemeChoice } from './ThemeSwitch';

/** Pages that read ?period=, and so open on the one you were looking at (V5). */
const KEEPS_PERIOD = new Set(['/', '/transactions']);

/**
 * Each section's mark. Flow is a line splitting in two, turned to run left to
 * right like the chart's own trunk.
 */
const ICONS: Record<string, { Icon: LucideIcon; turn?: boolean }> = {
  '/': { Icon: Split, turn: true },
  '/review': { Icon: Inbox },
  '/transactions': { Icon: Rows3 },
  '/accounts': { Icon: Landmark },
  '/setup': { Icon: Settings2 },
};

export type NavItem = { href: string; label: string; count?: number };

/**
 * Where a link goes and whether it is the page you are on. The Flow answers
 * at / and at its old address; /categories/[id] is a drill-down of the
 * register with no entry of its own, so it marks Register rather than leaving
 * every row unlit.
 */
function place(item: NavItem, pathname: string, period: string | null) {
  const active =
    item.href === '/'
      ? pathname === '/' || pathname.startsWith('/flow')
      : item.href === '/transactions'
        ? pathname.startsWith('/transactions') || pathname.startsWith('/categories')
        : pathname.startsWith(item.href);
  // Carried only between pages that share it. The value is passed through
  // as a query parameter, never as a destination (V7), and each page
  // validates it against the periods it knows.
  const href = period && KEEPS_PERIOD.has(item.href)
    ? `${item.href}?${new URLSearchParams({ period }).toString()}`
    : item.href;
  return { active, href };
}

/**
 * The sections, reading the period from the URL. Reading the URL suspends on
 * the server, so callers wrap this in Suspense with NavLinks as the fallback:
 * the same links without the period, so the nav never paints empty.
 */
function Nav(props: { items: readonly NavItem[]; variant: 'sidebar' | 'menu'; onChoose?: () => void }) {
  const period = useSearchParams().get('period');
  return <NavLinks {...props} period={period} />;
}

/**
 * The links themselves: rows of icon and name, the current one marked.
 * Marking it is not decoration — with five sections, "which page am I on"
 * stops being obvious from the heading alone.
 *
 * `sidebar` is responsive on its own: a rail of icons with their names
 * beneath on a tablet, full rows from 1024px. `menu` is always full rows.
 */
export function NavLinks({
  items,
  period,
  variant,
  onChoose,
}: {
  items: readonly NavItem[];
  period: string | null;
  variant: 'sidebar' | 'menu';
  onChoose?: () => void;
}) {
  const pathname = usePathname();
  const rail = variant === 'sidebar';

  return (
    <nav aria-label="Sections">
      <ul className={clsx('flex flex-col', rail ? 'gap-1 lg:gap-0.5' : 'gap-0.5')}>
        {items.map((item) => {
          const { active, href } = place(item, pathname, period);
          const { Icon, turn } = ICONS[item.href] ?? { Icon: Rows3 };
          const count = item.count !== undefined && item.count > 0 ? item.count : null;
          return (
            <li key={item.href}>
              <Link
                href={href}
                onClick={onChoose}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'relative flex items-center rounded-lg transition-colors',
                  rail
                    ? 'flex-col gap-1 px-1 py-2 text-[11px] lg:flex-row lg:gap-2.5 lg:px-2.5 lg:py-[7px] lg:text-sm'
                    : 'gap-3 px-3 py-2.5 text-[15px]',
                  active ? 'bg-well font-medium text-ink' : 'text-ink-dim hover:bg-well/60 hover:text-ink',
                )}
              >
                <Icon
                  aria-hidden
                  size={18}
                  strokeWidth={1.75}
                  className={clsx('shrink-0', turn && 'rotate-90', active ? 'text-ink' : 'text-ink-faint')}
                />
                <span className={clsx(rail && 'leading-none lg:leading-normal')}>{item.label}</span>
                {count !== null && (
                  <span
                    className={clsx(
                      'figure-display rounded-full px-1.5 text-[11px] font-semibold leading-[1.15rem]',
                      active ? 'bg-card text-ink' : 'bg-well text-ink-dim',
                      // On the rail the count sits on the icon's corner; in a
                      // row it closes the row.
                      rail ? 'absolute left-[calc(50%+3px)] top-0.5 text-[10px] lg:static lg:ml-auto lg:text-[11px]' : 'ml-auto',
                    )}
                  >
                    {count}
                    <span className="sr-only"> outstanding</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The app's name. Plain text, not a link: it and Flow both opened `/`. */
function Wordmark() {
  return <span className="text-[15px] font-semibold tracking-tight text-ink">ledger</span>;
}

/**
 * The sidebar: fixed to the left edge, the full height of the screen
 * whatever the page's length. Hidden on a phone, where MobileNav takes over.
 * Its widths (w-20, lg:w-56) are the ones the layout's main and the
 * register's selection bar leave room for.
 */
export function Sidebar({ items, theme }: { items: readonly NavItem[]; theme: ThemeChoice }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-rule bg-ground md:flex lg:w-56">
      <div className="flex h-16 shrink-0 items-center justify-center px-5 lg:justify-start">
        <Wordmark />
      </div>
      <div className="flex-1 overflow-y-auto px-2 lg:px-3">
        <Suspense fallback={<NavLinks items={items} period={null} variant="sidebar" />}>
          <Nav items={items} variant="sidebar" />
        </Suspense>
      </div>
      <div className="flex shrink-0 justify-center px-2 py-4 lg:justify-start lg:px-4">
        <ThemeSwitch initial={theme} className="flex flex-col gap-0.5 lg:flex-row" />
      </div>
    </aside>
  );
}

/**
 * On a phone: a bar across the top with the wordmark and a menu button that
 * opens the same sections as a panel beneath it. Choosing a page, Esc, or a
 * tap outside closes it, and Esc hands focus back to the button.
 */
export function MobileNav({ items, theme }: { items: readonly NavItem[]; theme: ThemeChoice }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // A page chosen from the panel closes it, however the navigation happened.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (bar.current && !bar.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const outstanding = items.reduce((a, i) => a + (i.count ?? 0), 0);

  return (
    <div ref={bar} data-topbar className="sticky top-0 z-30 border-b border-rule bg-ground/95 backdrop-blur md:hidden">
      <div className="flex h-13 items-center justify-between px-4">
        <Wordmark />
        <button
          ref={button}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? 'Close the menu' : 'Open the menu'}
          className="relative -mr-1.5 rounded-lg p-2 text-ink-dim transition-colors hover:bg-well hover:text-ink"
        >
          {open ? <X aria-hidden size={20} strokeWidth={1.75} /> : <Menu aria-hidden size={20} strokeWidth={1.75} />}
          {/* Something waits in Review: a dot, since the count is one tap away. */}
          {!open && outstanding > 0 && (
            <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-ink" />
          )}
        </button>
      </div>
      {open && (
        // Over the page, not in its flow: opening the menu never shifts what is beneath.
        <div id={panelId} className="absolute inset-x-0 top-full border-y border-rule bg-ground px-3 pb-4 pt-2 shadow-[0_16px_32px_-16px_rgb(0_0_0/0.25)]">
          <Suspense fallback={<NavLinks items={items} period={null} variant="menu" onChoose={() => setOpen(false)} />}>
            <Nav items={items} variant="menu" onChoose={() => setOpen(false)} />
          </Suspense>
          <div className="mt-3 flex items-center justify-between border-t border-rule px-3 pt-3 text-xs text-ink-faint">
            Theme
            <ThemeSwitch initial={theme} />
          </div>
        </div>
      )}
    </div>
  );
}
