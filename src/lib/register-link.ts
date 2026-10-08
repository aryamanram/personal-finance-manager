/**
 * The register, opened on exactly the rows behind a figure (V2 in
 * docs/design/OVERHAUL.md).
 *
 * A category can hold both required and discretionary rows — a necessity
 * override files one row differently from its category's default — and the
 * Flow draws those in different buckets, so a link carries the necessity as
 * well as the category. `category` means that category only, not its
 * subcategories, which the Flow lists separately.
 */
export function registerHref(r: {
  categoryId: string | null;
  necessity?: string;
  from: string;
  to: string;
}): string {
  const p = new URLSearchParams();
  if (r.categoryId) p.set('category', r.categoryId);
  else p.set('uncategorized', '1');
  if (r.necessity) p.set('necessity', r.necessity);
  p.set('from', r.from);
  p.set('to', r.to);
  return `/transactions?${p.toString()}`;
}
