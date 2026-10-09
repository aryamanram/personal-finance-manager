/**
 * The Flow's model: where a period's money came from and where it went.
 *
 * Pure — no database, no React — so the arithmetic is tested directly and the
 * charts only draw what this returns. It balances by construction, at every
 * level (V1 in docs/design/OVERHAUL.md): each bucket is the sum of its
 * categories, each category the sum of its subcategories and General, the
 * junction the sum of the sources and of the buckets, and whatever does not
 * balance becomes "From savings" or "Left over", never a gap. Folding the
 * small ones into "+N more" keeps every sum, because the fold is a node too.
 */
import { registerHref } from './register-link';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One category's spending in one bucket — a row of getFlow (lib/queries.ts). */
export interface FlowRow {
  category_id: string | null;
  category_name: string;
  category_group_name?: string;
  /** The parent, for a subcategory; null or absent at the top level. */
  parent_id?: string | null;
  parent_name?: string | null;
  necessity: string;
  /** Gross money out, positive. */
  total_cents: number;
  credit_cents: number;
  txn_count: number;
}

/** Structurally what getFlow returns, without importing it. */
export interface FlowInput {
  incomeCents: number;
  /** Net money into investments; negative when more came out than went in. */
  investedCents: number;
  creditsCents: number;
  categories: FlowRow[];
  /** Each group's palette slot, by group name (getGroupSlots). */
  groupSlots?: Record<string, number>;
  /** Each category's own shade of its group's colour, by id (lib/palette.ts). */
  colors?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export type SourceKey = 'income' | 'investments' | 'credits' | 'savings';
export type BucketKey = 'required' | 'discretionary' | 'invested' | 'leftover';

export interface FlowSource { key: SourceKey; label: string; cents: number }

/** Spending filed under one category (or subcategory) in one bucket. */
export interface FlowLeaf {
  /** The category the rows are filed under — the parent itself, for General. */
  id: string | null;
  name: string;
  /** The parent's own rows, not one of its subcategories'. */
  general: boolean;
  cents: number;
  creditCents: number;
  txnCount: number;
  /** Its own shade: a subcategory's offshoot of its parent's, General the parent's. */
  color: string | null;
}

/** A top-level category in one bucket: its own rows and its subcategories'. */
export interface FlowCategory {
  id: string | null;
  name: string;
  group: string;
  /** Palette slot, 1-8; null for a group without one (drawn in ink). */
  slot: number | null;
  /** Its own shade of the group's colour; null when the group has no slot. */
  color: string | null;
  cents: number;
  creditCents: number;
  txnCount: number;
  /**
   * Subcategories, and General for the parent's own rows — only when some of
   * this period's money is in a subcategory. Sums to `cents`.
   */
  children: FlowLeaf[];
}

export interface FlowBucket { key: BucketKey; label: string; cents: number; categories: FlowCategory[] }

export interface FlowModel {
  /** Only sources that carried money, in drawing order. */
  sources: FlowSource[];
  /** The junction: every source in, every bucket out. */
  totalCents: number;
  /** Required + discretionary: what "share of the month's spending" divides by. */
  spendingCents: number;
  /** Only buckets that carried money, in drawing order. */
  buckets: FlowBucket[];
}

const SPENDING: Record<string, 'required' | 'discretionary'> = { required: 'required', discretionary: 'discretionary' };

/** What the Flow calls spending filed on a parent rather than a subcategory. */
export const GENERAL = 'General';

const byCents = <T extends { cents: number; name: string }>(a: T, b: T) =>
  b.cents - a.cents || a.name.localeCompare(b.name);

/** Builds the Flow for a period, or null when no money moved. */
export function buildFlow(d: FlowInput): FlowModel | null {
  const slots = d.groupSlots ?? {};
  const colors = d.colors ?? {};
  const spending: Record<'required' | 'discretionary', Map<string, FlowCategory>> = {
    required: new Map(), discretionary: new Map(),
  };

  for (const r of d.categories) {
    if (r.total_cents <= 0) continue;
    const bucket = SPENDING[r.necessity];
    // counts_as_spending admits only these two; anything else would be money
    // the chart silently leaves out, which is exactly what V1 forbids.
    if (!bucket) {
      throw new Error(`Spending category ${r.category_name} has necessity "${r.necessity}"`);
    }
    const isSub = r.parent_id != null;
    const id = isSub ? r.parent_id! : r.category_id;
    const key = id ?? '∅';
    const group = r.category_group_name ?? 'Other';
    let cat = spending[bucket].get(key);
    if (!cat) {
      cat = {
        id,
        name: isSub ? (r.parent_name ?? r.category_name) : r.category_name,
        group,
        slot: slots[group] ?? null,
        color: (id && colors[id]) || null,
        cents: 0, creditCents: 0, txnCount: 0,
        children: [],
      };
      spending[bucket].set(key, cat);
    }
    cat.cents += r.total_cents;
    cat.creditCents += r.credit_cents;
    cat.txnCount += r.txn_count;
    cat.children.push({
      id: r.category_id,
      name: isSub ? r.category_name : GENERAL,
      general: !isSub,
      cents: r.total_cents,
      creditCents: r.credit_cents,
      txnCount: r.txn_count,
      color: (r.category_id && colors[r.category_id]) || cat.color,
    });
  }

  const finish = (m: Map<string, FlowCategory>) => [...m.values()].map((c) => ({
    ...c,
    // A category with nothing in a subcategory this period has no children
    // to draw: its only "child" would be General, the whole of it again.
    children: c.children.some((x) => !x.general)
      // General last: it is the remainder, read after the named parts.
      ? [...c.children].sort((a, b) => Number(a.general) - Number(b.general) || byCents(a, b))
      : [],
  })).sort(byCents);

  const required = finish(spending.required);
  const discretionary = finish(spending.discretionary);
  const sum = (xs: FlowCategory[]) => xs.reduce((a, c) => a + c.cents, 0);
  const requiredCents = sum(required);
  const discretionaryCents = sum(discretionary);
  const invested = Math.max(0, d.investedCents);
  const fromInvestments = Math.max(0, -d.investedCents);
  const income = Math.max(0, d.incomeCents);
  const credits = Math.max(0, d.creditsCents);

  const moneyIn = income + fromInvestments + credits;
  const moneyOut = requiredCents + discretionaryCents + invested;
  const leftover = Math.max(0, moneyIn - moneyOut);
  const savings = Math.max(0, moneyOut - moneyIn);
  const totalCents = moneyIn + savings;
  if (totalCents <= 0) return null;

  const sources = ([
    { key: 'income', label: 'Income', cents: income },
    { key: 'investments', label: 'From investments', cents: fromInvestments },
    { key: 'credits', label: 'Credits', cents: credits },
    { key: 'savings', label: 'From savings', cents: savings },
  ] satisfies FlowSource[]).filter((s) => s.cents > 0);

  const buckets = ([
    { key: 'required', label: 'Required', cents: requiredCents, categories: required },
    { key: 'discretionary', label: 'Discretionary', cents: discretionaryCents, categories: discretionary },
    { key: 'invested', label: 'Invested', cents: invested, categories: [] },
    { key: 'leftover', label: 'Left over', cents: leftover, categories: [] },
  ] satisfies FlowBucket[]).filter((b) => b.cents > 0);

  return { sources, totalCents, spendingCents: requiredCents + discretionaryCents, buckets };
}

// ---------------------------------------------------------------------------
// A category's own Flow
// ---------------------------------------------------------------------------

/** Structurally a row of getCategoryFlow (lib/queries.ts). */
export interface CategoryFlowInputRow {
  category_id: string;
  category_name: string;
  necessity: string;
  merchant_id: string | null;
  merchant_name: string;
  total_cents: number;
  credit_cents: number;
  txn_count: number;
}

export interface FlowMerchant { id: string | null; name: string; cents: number; creditCents: number; txnCount: number }

/** One subcategory (or General, or the category itself) and its merchants. */
export interface CategoryFlowLeaf extends FlowLeaf { merchants: FlowMerchant[] }

export interface CategoryFlowModel {
  id: string;
  name: string;
  group: string;
  slot: number | null;
  /** Its own shade; its leaves carry theirs. */
  color: string | null;
  cents: number;
  creditCents: number;
  txnCount: number;
  /** Which buckets paid for it. */
  buckets: { key: 'required' | 'discretionary'; label: string; cents: number }[];
  /**
   * Subcategories and General when any money is in a subcategory; otherwise
   * one leaf, the category itself, so merchants hang off it directly.
   */
  leaves: CategoryFlowLeaf[];
  /** True when `leaves` are subcategories, false when it is the category alone. */
  split: boolean;
}

/** A category's Flow down to merchants, or null when nothing was spent in it. */
export function buildCategoryFlow(
  root: { id: string; name: string; group: string; slot: number | null; color?: string | null },
  rows: CategoryFlowInputRow[],
  colors: Record<string, string> = {},
): CategoryFlowModel | null {
  const rootColor = root.color ?? colors[root.id] ?? null;
  const spent = rows.filter((r) => r.total_cents > 0);
  if (spent.length === 0) return null;

  const bucketCents = { required: 0, discretionary: 0 };
  const leaves = new Map<string, CategoryFlowLeaf>();
  for (const r of spent) {
    const bucket = SPENDING[r.necessity];
    if (!bucket) throw new Error(`Spending row in ${r.category_name} has necessity "${r.necessity}"`);
    bucketCents[bucket] += r.total_cents;

    const general = r.category_id === root.id;
    let leaf = leaves.get(r.category_id);
    if (!leaf) {
      leaf = {
        id: r.category_id, name: general ? GENERAL : r.category_name, general,
        cents: 0, creditCents: 0, txnCount: 0, merchants: [],
        color: colors[r.category_id] ?? rootColor,
      };
      leaves.set(r.category_id, leaf);
    }
    leaf.cents += r.total_cents;
    leaf.creditCents += r.credit_cents;
    leaf.txnCount += r.txn_count;
    // A merchant can appear twice under one leaf — once per bucket — and is
    // one merchant here: this Flow splits by subcategory, not by necessity.
    const mKey = r.merchant_id ?? `name:${r.merchant_name}`;
    const existing = leaf.merchants.find((m) => (m.id ?? `name:${m.name}`) === mKey);
    if (existing) {
      existing.cents += r.total_cents;
      existing.creditCents += r.credit_cents;
      existing.txnCount += r.txn_count;
    } else {
      leaf.merchants.push({
        id: r.merchant_id, name: r.merchant_name,
        cents: r.total_cents, creditCents: r.credit_cents, txnCount: r.txn_count,
      });
    }
  }

  const all = [...leaves.values()];
  for (const l of all) l.merchants.sort(byCents);
  const split = all.some((l) => !l.general);
  const sorted = split
    ? all.sort((a, b) => Number(a.general) - Number(b.general) || byCents(a, b))
    : all.map((l) => ({ ...l, name: root.name }));

  const cents = all.reduce((a, l) => a + l.cents, 0);
  return {
    ...root,
    color: rootColor,
    cents,
    creditCents: all.reduce((a, l) => a + l.creditCents, 0),
    txnCount: all.reduce((a, l) => a + l.txnCount, 0),
    buckets: ([
      { key: 'required', label: 'Required', cents: bucketCents.required },
      { key: 'discretionary', label: 'Discretionary', cents: bucketCents.discretionary },
    ] as const).filter((b) => b.cents > 0).map((b) => ({ ...b })),
    leaves: sorted,
    split,
  };
}

// ---------------------------------------------------------------------------
// Drawing: nodes and links, folded
// ---------------------------------------------------------------------------

/**
 * How a node is painted. Neutral inks for money that has not been spent yet
 * (sources, buckets), the hatch for savings in either direction, and the
 * group's slot for where it was spent. The component maps these to tokens.
 */
export type Tone =
  | { kind: 'strong' }
  | { kind: 'mid' }
  | { kind: 'hatch' }
  | { kind: 'group'; slot: number | null; color?: string | null };

export type NodeKind =
  | 'source' | 'junction' | 'bucket' | 'category' | 'subcategory' | 'general' | 'more' | 'merchant';

export type NodeAction =
  /** Open this category's own Flow. */
  | { type: 'focus'; id: string }
  /** Unfold the node that folded these. */
  | { type: 'expand'; key: string }
  /** The register on exactly these rows. */
  | { type: 'rows'; href: string };

export interface GraphNode {
  key: string;
  /** Left to right; a column can be empty in a month that has no such node. */
  column: number;
  /** Top to bottom within the column. */
  order: number;
  name: string;
  /** Drawn beside the node. */
  label?: string;
  kind: NodeKind;
  cents: number;
  creditCents?: number;
  txnCount?: number;
  /** Of the month's spending, for spending nodes; of everything, for the rest. */
  share?: number;
  tone: Tone;
  action?: NodeAction;
  /** A second action, for nodes whose click looks inside: their rows. */
  rows?: string;
}

export interface GraphLink { source: string; target: string; cents: number; tone: Tone }
export interface FlowGraph { nodes: GraphNode[]; links: GraphLink[] }

/** Top categories per bucket before the rest fold into "+N more". */
export const MAX_CATEGORIES = 6;
/** Top subcategories per category before the rest fold. */
export const MAX_CHILDREN = 4;
/** Top merchants per leaf in a category's own Flow. */
export const MAX_MERCHANTS = 5;

/**
 * The first `max`, and the rest — unless the rest is a single item, which
 * would fold one thing into a node naming one thing.
 */
function fold<T>(items: T[], max: number, open: boolean): { shown: T[]; rest: T[] } {
  if (open || items.length <= max + 1) return { shown: items, rest: [] };
  return { shown: items.slice(0, max), rest: items.slice(max) };
}

const SOURCE_TONE: Record<SourceKey, Tone> = {
  income: { kind: 'strong' }, investments: { kind: 'mid' }, credits: { kind: 'mid' }, savings: { kind: 'hatch' },
};
/** Alternating so neighbours separate by lightness; the hatch is savings. */
const BUCKET_TONE: Record<BucketKey, Tone> = {
  required: { kind: 'strong' }, discretionary: { kind: 'mid' }, invested: { kind: 'strong' }, leftover: { kind: 'hatch' },
};
const NECESSITY: Record<BucketKey, string | undefined> = {
  required: 'required', discretionary: 'discretionary', invested: 'investment', leftover: undefined,
};

/**
 * The main Flow as a graph: sources, junction, buckets, categories and one
 * level of subcategories.
 *
 * Within a bucket, categories run by group slot and then by amount, so each
 * group is one band of colour and neighbouring colours are neighbouring slots
 * — the pairs the palette was validated on (V9). The largest categories are
 * chosen first and only then ordered, so folding never hides a big one.
 */
export function flowGraph(
  m: FlowModel,
  period: { from: string; to: string },
  expanded: ReadonlySet<string> = new Set(),
): FlowGraph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  let order = 0;
  const push = (n: Omit<GraphNode, 'order'>) => { nodes.push({ ...n, order: order++ }); return n.key; };
  const rows = (r: Omit<Parameters<typeof registerHref>[0], 'from' | 'to'>) => registerHref({ ...r, ...period });
  const ofSpending = (c: number) => (m.spendingCents > 0 ? c / m.spendingCents : 0);

  for (const s of m.sources) {
    push({
      key: `source:${s.key}`, column: 0, name: s.label, label: s.label, kind: 'source',
      cents: s.cents, share: s.cents / m.totalCents, tone: SOURCE_TONE[s.key],
      action: s.key === 'income' ? { type: 'rows', href: rows({ necessity: 'income' }) }
        : s.key === 'credits' ? { type: 'rows', href: rows({ credits: true }) }
        : s.key === 'investments' ? { type: 'rows', href: rows({ necessity: 'investment' }) }
        : undefined,
    });
    links.push({ source: `source:${s.key}`, target: 'junction', cents: s.cents, tone: SOURCE_TONE[s.key] });
  }
  // The trunk's total, labelled: where the sources become one stream and
  // the money visibly splits.
  push({
    key: 'junction', column: 1, name: 'Available', label: 'Available', kind: 'junction',
    cents: m.totalCents, share: 1, tone: { kind: 'strong' },
  });

  for (const b of m.buckets) {
    const bucketKey = `bucket:${b.key}`;
    const necessity = NECESSITY[b.key];
    push({
      key: bucketKey, column: 2, name: b.label, label: b.label, kind: 'bucket',
      cents: b.cents, share: b.cents / m.totalCents, tone: BUCKET_TONE[b.key],
      action: necessity ? { type: 'rows', href: rows({ necessity }) } : undefined,
    });
    links.push({ source: 'junction', target: bucketKey, cents: b.cents, tone: BUCKET_TONE[b.key] });
  }

  // Columns 3 and 4 are laid out after every bucket, so their order follows
  // the buckets' order top to bottom.
  for (const b of m.buckets) {
    if (b.categories.length === 0) continue;
    const bucketKey = `bucket:${b.key}`;
    const necessity = NECESSITY[b.key];
    const { shown, rest } = fold(b.categories, MAX_CATEGORIES, expanded.has(bucketKey));
    const ordered = [...shown].sort((x, y) => (x.slot ?? 99) - (y.slot ?? 99) || byCents(x, y));

    for (const c of ordered) {
      const catKey = `cat:${b.key}:${c.id ?? 'none'}`;
      const tone: Tone = { kind: 'group', slot: c.slot, color: c.color };
      const own = rows({ categoryId: c.id, withSubcategories: true, necessity });
      push({
        key: catKey, column: 3, name: c.name, label: c.name, kind: 'category',
        cents: c.cents, creditCents: c.creditCents, txnCount: c.txnCount, share: ofSpending(c.cents), tone,
        action: c.id ? { type: 'focus', id: c.id } : { type: 'rows', href: own },
        rows: own,
      });
      links.push({ source: bucketKey, target: catKey, cents: c.cents, tone });
    }
    if (rest.length > 0) {
      const cents = rest.reduce((a, c) => a + c.cents, 0);
      const key = `more:${b.key}`;
      push({
        key, column: 3, name: `${rest.length} more ${b.label.toLowerCase()}`,
        label: `+${rest.length} more`, kind: 'more', cents, share: ofSpending(cents),
        txnCount: rest.reduce((a, c) => a + c.txnCount, 0),
        tone: { kind: 'mid' }, action: { type: 'expand', key: bucketKey },
      });
      links.push({ source: bucketKey, target: key, cents, tone: { kind: 'mid' } });
    }
  }

  for (const b of m.buckets) {
    const necessity = NECESSITY[b.key];
    const { shown } = fold(b.categories, MAX_CATEGORIES, expanded.has(`bucket:${b.key}`));
    const ordered = [...shown].sort((x, y) => (x.slot ?? 99) - (y.slot ?? 99) || byCents(x, y));
    for (const c of ordered) {
      if (c.children.length === 0) continue;
      const catKey = `cat:${b.key}:${c.id ?? 'none'}`;
      const tone: Tone = { kind: 'group', slot: c.slot, color: c.color };
      const { shown: kids, rest } = fold(c.children, MAX_CHILDREN, expanded.has(catKey));
      for (const k of kids) {
        const kidTone: Tone = { kind: 'group', slot: c.slot, color: k.color };
        const key = `${catKey}:${k.general ? 'general' : k.id}`;
        const href = rows({ categoryId: k.id, necessity });
        push({
          key, column: 4, name: k.general ? `${c.name}, not in a subcategory` : k.name,
          label: k.name, kind: k.general ? 'general' : 'subcategory',
          cents: k.cents, creditCents: k.creditCents, txnCount: k.txnCount, share: ofSpending(k.cents), tone: kidTone,
          // General is the parent's own rows: looking inside it is looking
          // inside the parent, which is one click to the left.
          action: !k.general && k.id ? { type: 'focus', id: k.id } : { type: 'rows', href },
          rows: href,
        });
        links.push({ source: catKey, target: key, cents: k.cents, tone: kidTone });
      }
      if (rest.length > 0) {
        const cents = rest.reduce((a, k) => a + k.cents, 0);
        const key = `${catKey}:more`;
        push({
          key, column: 4, name: `${rest.length} more in ${c.name}`, label: `+${rest.length} more`,
          kind: 'more', cents, share: ofSpending(cents), txnCount: rest.reduce((a, k) => a + k.txnCount, 0),
          tone, action: { type: 'expand', key: catKey },
        });
        links.push({ source: catKey, target: key, cents, tone });
      }
    }
  }

  return { nodes, links };
}

/**
 * A category's own Flow as a graph: the buckets that paid for it, the
 * category, its subcategories, their merchants. Subcategories never fold here
 * — this is the place to see all of them — and merchants do.
 */
export function categoryGraph(
  c: CategoryFlowModel,
  period: { from: string; to: string },
  expanded: ReadonlySet<string> = new Set(),
): FlowGraph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  let order = 0;
  const push = (n: Omit<GraphNode, 'order'>) => { nodes.push({ ...n, order: order++ }); return n.key; };
  const rows = (r: Omit<Parameters<typeof registerHref>[0], 'from' | 'to'>) => registerHref({ ...r, ...period });
  const tone: Tone = { kind: 'group', slot: c.slot, color: c.color };
  const leafTone = (l: CategoryFlowLeaf): Tone => ({ kind: 'group', slot: c.slot, color: l.color });
  const of = (cents: number) => (c.cents > 0 ? cents / c.cents : 0);

  for (const b of c.buckets) {
    const key = `bucket:${b.key}`;
    push({
      key, column: 0, name: b.label, label: b.label, kind: 'bucket', cents: b.cents, share: of(b.cents),
      tone: BUCKET_TONE[b.key],
      action: { type: 'rows', href: rows({ categoryId: c.id, withSubcategories: true, necessity: b.key }) },
    });
    links.push({ source: key, target: 'root', cents: b.cents, tone: BUCKET_TONE[b.key] });
  }
  const all = rows({ categoryId: c.id, withSubcategories: true });
  push({
    key: 'root', column: 1, name: c.name, label: c.name, kind: 'category', cents: c.cents,
    creditCents: c.creditCents, txnCount: c.txnCount, share: 1, tone,
    action: { type: 'rows', href: all }, rows: all,
  });

  const merchantColumn = c.split ? 3 : 2;
  const leafKeys: [CategoryFlowLeaf, string][] = [];
  for (const l of c.leaves) {
    if (!c.split) { leafKeys.push([l, 'root']); continue; }
    const key = `leaf:${l.general ? 'general' : l.id}`;
    const href = rows({ categoryId: l.id });
    push({
      key, column: 2, name: l.general ? `${c.name}, not in a subcategory` : l.name, label: l.name,
      kind: l.general ? 'general' : 'subcategory', cents: l.cents, creditCents: l.creditCents,
      txnCount: l.txnCount, share: of(l.cents), tone: leafTone(l),
      action: !l.general && l.id ? { type: 'focus', id: l.id } : { type: 'rows', href },
      rows: href,
    });
    links.push({ source: 'root', target: key, cents: l.cents, tone: leafTone(l) });
    leafKeys.push([l, key]);
  }

  for (const [l, parentKey] of leafKeys) {
    const { shown, rest } = fold(l.merchants, MAX_MERCHANTS, expanded.has(parentKey));
    for (const mer of shown) {
      const key = `${parentKey}:m:${mer.id ?? mer.name}`;
      push({
        key, column: merchantColumn, name: mer.name, label: mer.name, kind: 'merchant',
        cents: mer.cents, creditCents: mer.creditCents, txnCount: mer.txnCount, share: of(mer.cents), tone: leafTone(l),
        action: {
          type: 'rows',
          href: mer.id ? rows({ categoryId: l.id, merchantId: mer.id }) : rows({ categoryId: l.id }),
        },
      });
      links.push({ source: parentKey, target: key, cents: mer.cents, tone: leafTone(l) });
    }
    if (rest.length > 0) {
      const cents = rest.reduce((a, x) => a + x.cents, 0);
      const key = `${parentKey}:more`;
      push({
        key, column: merchantColumn, name: `${rest.length} more merchants`, label: `+${rest.length} more`,
        kind: 'more', cents, share: of(cents), txnCount: rest.reduce((a, x) => a + x.txnCount, 0),
        tone: leafTone(l), action: { type: 'expand', key: parentKey },
      });
      links.push({ source: parentKey, target: key, cents, tone: leafTone(l) });
    }
  }

  return { nodes, links };
}

// ---------------------------------------------------------------------------
// What can be looked inside
// ---------------------------------------------------------------------------

/** A category or subcategory that spent this period, for the picker. */
export interface InsideOption {
  id: string;
  name: string;
  group: string;
  slot: number | null;
  color: string | null;
  /** Across both buckets: a category spent in two is one choice. */
  cents: number;
  /** The parent, for a subcategory. */
  parentId?: string;
  parentName?: string;
  /** Whether it has subcategories that spent this period. */
  split?: boolean;
}

/**
 * Every category and subcategory that spent this period, in palette order:
 * by group, then by amount, each parent followed by its subcategories.
 */
export function insideOptions(m: FlowModel | null): InsideOption[] {
  const cats = new Map<string, InsideOption & { kids: Map<string, InsideOption> }>();
  for (const b of m?.buckets ?? []) {
    for (const c of b.categories) {
      if (!c.id) continue;
      const opt = cats.get(c.id) ?? { id: c.id, name: c.name, group: c.group, slot: c.slot, color: c.color, cents: 0, kids: new Map() };
      opt.cents += c.cents;
      for (const k of c.children) {
        if (k.general || !k.id) continue;
        const kid = opt.kids.get(k.id) ?? {
          id: k.id, name: k.name, group: c.group, slot: c.slot, color: k.color, cents: 0, parentId: c.id, parentName: c.name,
        };
        kid.cents += k.cents;
        opt.kids.set(k.id, kid);
      }
      cats.set(c.id, opt);
    }
  }
  return [...cats.values()]
    .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.group.localeCompare(b.group) || byCents(a, b))
    .flatMap(({ kids, ...c }) => [{ ...c, split: kids.size > 0 }, ...[...kids.values()].sort(byCents)]);
}

/**
 * What to show inside when nothing has been chosen: the largest category
 * that splits into subcategories, since that is the view this level exists
 * for; failing that, the largest category.
 */
export function defaultInside(options: InsideOption[]): InsideOption | undefined {
  const top = options.filter((o) => !o.parentId).sort(byCents);
  return top.find((o) => o.split) ?? top[0];
}
