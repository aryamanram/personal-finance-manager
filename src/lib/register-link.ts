/**
 * The register, opened on exactly the rows behind a figure (V2 in
 * docs/design/OVERHAUL.md).
 *
 * A category can hold both required and discretionary rows — a necessity
 * override files one row differently from its category's default — and the
 * Flow draws those in different buckets, so a link carries the necessity as
 * well as the category. `category` means that category only; with
 * `withSubcategories` it means the category and everything under it, which is
 * what a parent's node in the Flow adds up.
 */
export function registerHref(r: {
  /** A category; null for uncategorised rows; absent for any category. */
  categoryId?: string | null;
  /** The category and its subcategories, not the category alone. */
  withSubcategories?: boolean;
  necessity?: string;
  /** One merchant's rows, from a category's own Flow. */
  merchantId?: string | null;
  /** Only money coming back on spending rows: the Flow's Credits source. */
  credits?: boolean;
  from: string;
  to: string;
}): string {
  const p = new URLSearchParams();
  if (r.categoryId) {
    p.set('category', r.categoryId);
    if (r.withSubcategories) p.set('sub', '1');
  } else if (r.categoryId === null) {
    p.set('uncategorized', '1');
  }
  if (r.necessity) p.set('necessity', r.necessity);
  if (r.merchantId) p.set('merchant', r.merchantId);
  if (r.credits) p.set('credits', '1');
  p.set('from', r.from);
  p.set('to', r.to);
  return `/transactions?${p.toString()}`;
}
