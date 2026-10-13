/**
 * A part of a whole, as the Flow prints it: one decimal, and never "0.0%"
 * for a part that is there — $1.77 of $10,801.77 is "<0.1%", not nothing.
 */
export function formatShare(fraction: number): string {
  if (fraction > 0 && fraction < 0.0005) return '<0.1%';
  return `${(fraction * 100).toFixed(1)}%`;
}
