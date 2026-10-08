/**
 * The register's URL, read into the filters its rows, count and totals share.
 *
 * Out of the page so a test can open a link the way the page does: the Flow's
 * links promise a number (V2), and the only honest check is to read each one
 * with this function and total what it selects. A test that rebuilt the
 * mapping would pass while the page's own reading was wrong.
 */
import { NECESSITIES, type CategoryWithGroup } from './types';
import type { TransactionFilters } from './queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RegisterView {
  filters: TransactionFilters;
  /** The category asked for by a link, when it names a known one. */
  linkedCategory?: CategoryWithGroup;
  /** Whether that link includes the category's subcategories. */
  withSubcategories: boolean;
  linkedNecessity?: (typeof NECESSITIES)[number];
  /** Categories hidden by the category filter, after the defaults. */
  hiddenCategoryIds: string[];
  /** The register's default hidden set: Credit Card Payment. */
  defaultHiddenIds: string[];
}

export function registerView(
  get: (key: string) => string | undefined,
  categories: CategoryWithGroup[],
  period?: { from: string; to: string },
): RegisterView {
  const defaultHiddenIds = categories.filter((c) => c.name === 'Credit Card Payment').map((c) => c.id);
  const hideParam = get('hide');

  // Validated rather than passed through — a malformed id would otherwise
  // reach the query as a uuid cast and fail the whole page.
  const linkedCategory = categories.find((c) => c.id === get('category'));
  const withSubcategories = !!linkedCategory && get('sub') === '1';
  const linkedNecessity = NECESSITIES.find((n) => n === get('necessity'));
  const merchant = get('merchant');
  // A link that names its rows — a category, the credits, a merchant — shows
  // them even if they are hidden by default.
  const named = !!linkedCategory || get('credits') === '1' || (merchant && UUID.test(merchant));
  const hiddenCategoryIds = named && !hideParam
    ? []
    : resolveHidden(hideParam, categories, defaultHiddenIds);

  const filters: TransactionFilters = {
    // An explicit from/to still wins, so a link with a hand-built range works.
    from: get('from') ?? period?.from,
    to: get('to') ?? period?.to,
    accountIds: get('account') ? [get('account')!] : undefined,
    excludeCategoryIds: hiddenCategoryIds,
    leafCategoryIds: linkedCategory && !withSubcategories ? [linkedCategory.id] : undefined,
    categoryIds: linkedCategory && withSubcategories ? [linkedCategory.id] : undefined,
    merchantIds: merchant && UUID.test(merchant) ? [merchant] : undefined,
    creditsOnly: get('credits') === '1',
    necessity: linkedNecessity ? [linkedNecessity] : undefined,
    search: get('q'),
    uncategorizedOnly: get('uncategorized') === '1',
    needsReviewOnly: get('review') === '1',
    includeVoided: get('voided') === '1',
  };

  return { filters, linkedCategory, withSubcategories, linkedNecessity, hiddenCategoryIds, defaultHiddenIds };
}

/**
 * Which categories the register hides, from the `hide` param.
 *
 * Four forms, because the param has to distinguish "nothing was said" from
 * "nothing is hidden", and because naming 55 uuids to hide is a worse URL than
 * naming the 3 to show:
 *
 *   absent            the default (Credit Card Payment)
 *   none              hide nothing
 *   all               hide everything
 *   only:<a>,<b>      show ONLY these
 *   <a>,<b>           hide these
 */
export function resolveHidden(
  param: string | undefined,
  categories: CategoryWithGroup[],
  fallback: string[],
): string[] {
  if (!param) return fallback;
  if (param === 'none') return [];
  if (param === 'all') return categories.map((c) => c.id);
  if (param.startsWith('only:')) {
    const shown = new Set(param.slice('only:'.length).split(',').filter(Boolean));
    return categories.filter((c) => !shown.has(c.id)).map((c) => c.id);
  }
  return param.split(',').filter(Boolean);
}
