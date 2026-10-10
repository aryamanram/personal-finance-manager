'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'Match the system', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** A year: the choice is a preference, not a session. */
const MAX_AGE = 60 * 60 * 24 * 365;

/**
 * System, light or dark.
 *
 * The choice is a cookie, not localStorage, because the server reads it:
 * layout.tsx writes data-theme on <html> before anything paints, so a pinned
 * theme never flashes the other one first. "System" removes the pin and lets
 * `color-scheme: light dark` follow the operating system.
 */
export function ThemeSwitch({
  initial,
  className = 'flex items-center gap-0.5',
}: {
  initial: ThemeChoice;
  /** The group's own layout: a row by default, a column on the sidebar's rail. */
  className?: string;
}) {
  // What the page shows now, not only what the server sent: the menu on a
  // phone mounts its own switch each time it opens, possibly after the
  // sidebar's changed the theme. On first paint the two agree.
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    if (typeof document === 'undefined') return initial;
    const pinned = document.documentElement.dataset.theme;
    return pinned === 'light' || pinned === 'dark' ? pinned : 'system';
  });

  const choose = (next: ThemeChoice) => {
    setTheme(next);
    const root = document.documentElement;
    if (next === 'system') {
      delete root.dataset.theme;
      document.cookie = 'theme=; path=/; max-age=0; samesite=lax';
    } else {
      root.dataset.theme = next;
      document.cookie = `theme=${next}; path=/; max-age=${MAX_AGE}; samesite=lax`;
    }
  };

  return (
    <div role="group" aria-label="Theme" className={className}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-pressed={theme === value}
          aria-label={label}
          title={label}
          className={clsx(
            'rounded-sm p-1.5 transition-colors',
            theme === value
              ? 'bg-well text-ink'
              : 'text-ink-faint hover:text-ink',
          )}
        >
          <Icon aria-hidden size={14} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
