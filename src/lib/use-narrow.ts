'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the screen is phone-narrow. False on the server and on the first
 * client render, so hydration matches; it settles after mount.
 */
export function useNarrow(query = '(max-width: 639px)'): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    setNarrow(m.matches);
    const on = (e: MediaQueryListEvent) => setNarrow(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return narrow;
}
