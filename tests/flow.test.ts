/**
 * V1 and V2 of docs/design/OVERHAUL.md, against the app's own queries.
 *
 * V1 — the Flow balances to the cent: sources = junction = buckets, and each
 *      bucket is the sum of its categories, in every shape a month can take.
 * V2 — a category's figure is the register's total for that category, so
 *      clicking it lands on the same number.
 *
 * And the bridge to the numbers the app already shows: gross spending minus
 * credits is exactly what v_monthly_cashflow reports, so drawing gross changes
 * how the money is shown, not how much there is.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { createTestDb } from './helpers/db';
import { fingerprint } from '@/ingest/fingerprint';
import {
  buildFlow, buildCategoryFlow, flowGraph, categoryGraph, MAX_CATEGORIES,
  type FlowModel, type FlowGraph, type FlowInput,
} from '@/lib/flow';
import { registerView } from '@/lib/register-filters';
import type { CategoryWithGroup } from '@/lib/types';

let sql: Sql;
let drop: () => Promise<void>;
let q: typeof import('@/lib/queries');
let accountId: string;
const cat: Record<string, string> = {};

async function insert(row: {
  description: string; amountCents: number; postedDate: string; category: string;
  status?: 'posted' | 'pending'; voided?: boolean; necessityOverride?: string;
}) {
  await sql`
    INSERT INTO transactions
      (account_id, raw_description, amount_cents, posted_date, status, source, fingerprint,
       category_id, category_source, necessity_override, voided_at, void_reason)
    VALUES (${accountId}, ${row.description}, ${row.amountCents}, ${row.postedDate},
            ${row.status ?? 'posted'}, 'simplefin',
            ${fingerprint({ accountId, postedDate: row.postedDate, amountCents: row.amountCents, rawDescription: row.description })},
            ${cat[row.category]}, 'manual', ${row.necessityOverride ?? null},
            ${row.voided ? new Date('2026-09-01T12:00:00Z') : null}, ${row.voided ? 'duplicate' : null})`;
}

beforeAll(async () => {
  const db = await createTestDb('flow');
  sql = db.sql;
  drop = db.drop;
  process.env.DATABASE_URL = db.url;
  q = await import('@/lib/queries');

  // A subcategory, so a parent's own rows and its rolled-up total differ.
  await sql`
    INSERT INTO categories (group_id, name, parent_id, default_cost_type, default_necessity)
    SELECT group_id, 'Groceries Bulk', id, default_cost_type, default_necessity
    FROM categories WHERE name = 'Groceries'`;
  for (const { id, name } of await sql<{ id: string; name: string }[]>`SELECT id, name FROM categories`) cat[name] = id;
  const [inst] = await sql<{ id: string }[]>`INSERT INTO institutions (name, source) VALUES ('Bank', 'simplefin') RETURNING id`;
  [{ id: accountId }] = await sql<{ id: string }[]>`
    INSERT INTO accounts (institution_id, name, type, source, external_id)
    VALUES (${inst.id}, 'Checking', 'depository', 'simplefin', 'chk') RETURNING id`;

  // May: the ordinary month, with both kinds of credit.
  await insert({ description: 'PAYROLL', amountCents: 500000, postedDate: '2026-05-15', category: 'Paycheck' });
  await insert({ description: 'RENT', amountCents: -200000, postedDate: '2026-05-01', category: 'Rent' });
  await insert({ description: 'GROCER', amountCents: -30000, postedDate: '2026-05-03', category: 'Groceries' });
  await insert({ description: 'GROCER REFUND', amountCents: 2000, postedDate: '2026-05-09', category: 'Groceries' });
  await insert({ description: 'BISTRO', amountCents: -15000, postedDate: '2026-05-06', category: 'Restaurants' });
  // One grocery run filed as discretionary: Groceries now sits in two buckets.
  await insert({ description: 'GROCER PARTY', amountCents: -5000, postedDate: '2026-05-20', category: 'Groceries', necessityOverride: 'discretionary' });
  await insert({ description: 'WAREHOUSE CLUB', amountCents: -7000, postedDate: '2026-05-21', category: 'Groceries Bulk' });
  // Daily Cash: a credit filed against discretionary spending, nothing else in it.
  await insert({ description: 'DAILY CASH', amountCents: 222, postedDate: '2026-05-18', category: 'Reimbursement', necessityOverride: 'discretionary' });
  await insert({ description: 'BROKERAGE', amountCents: -100000, postedDate: '2026-05-16', category: 'Brokerage Contribution' });
  // Neither of these is spending yet / any more.
  await insert({ description: 'BISTRO PENDING', amountCents: -9999, postedDate: '2026-05-30', category: 'Restaurants', status: 'pending' });
  await insert({ description: 'GROCER DUPLICATE', amountCents: -8888, postedDate: '2026-05-04', category: 'Groceries', voided: true });

  // June: spent more than came in.
  await insert({ description: 'PAYROLL', amountCents: 100000, postedDate: '2026-06-15', category: 'Paycheck' });
  await insert({ description: 'RENT', amountCents: -200000, postedDate: '2026-06-01', category: 'Rent' });
  await insert({ description: 'BISTRO', amountCents: -5000, postedDate: '2026-06-06', category: 'Restaurants' });

  // July: no income at all.
  await insert({ description: 'GROCER', amountCents: -4000, postedDate: '2026-07-03', category: 'Groceries' });

  // August: money came OUT of investments.
  await insert({ description: 'BROKERAGE WITHDRAWAL', amountCents: 50000, postedDate: '2026-08-10', category: 'Brokerage Contribution' });
  await insert({ description: 'GROCER', amountCents: -20000, postedDate: '2026-08-12', category: 'Groceries' });

  // The grocer is a known merchant; the rest are only descriptions.
  const [grocer] = await sql<{ id: string }[]>`
    INSERT INTO merchants (normalized_name, display_name) VALUES ('grocer', 'Grocer') RETURNING id`;
  await sql`UPDATE transactions SET merchant_id = ${grocer.id} WHERE raw_description LIKE 'GROCER%'`;
});

afterAll(async () => { await drop(); });

const MONTHS = {
  may: ['2026-05-01', '2026-05-31'], june: ['2026-06-01', '2026-06-30'],
  july: ['2026-07-01', '2026-07-31'], august: ['2026-08-01', '2026-08-31'],
} as const;

async function flowFor(range: readonly [string, string]) {
  const data = { ...(await q.getFlow(range[0], range[1])), groupSlots: await q.getGroupSlots() };
  return { data, model: buildFlow(data) };
}

/** V1, stated once and asserted for every month. */
function expectBalanced(m: FlowModel) {
  const sources = m.sources.reduce((a, s) => a + s.cents, 0);
  const buckets = m.buckets.reduce((a, b) => a + b.cents, 0);
  expect(sources).toBe(m.totalCents);
  expect(buckets).toBe(m.totalCents);
  for (const b of m.buckets) {
    if (b.categories.length) expect(b.categories.reduce((a, c) => a + c.cents, 0)).toBe(b.cents);
    for (const c of b.categories) {
      expect(Number.isInteger(c.cents)).toBe(true);
      // A category with subcategories is exactly its subcategories and General.
      if (c.children.length) expect(c.children.reduce((a, k) => a + k.cents, 0), c.name).toBe(c.cents);
    }
  }
}

/**
 * V1 for what is drawn: every node's ribbons in and out carry its amount, so
 * folding into "+N more" or splitting into subcategories loses nothing.
 */
function expectGraphBalanced(g: FlowGraph) {
  for (const n of g.nodes) {
    const into = g.links.filter((l) => l.target === n.key).reduce((a, l) => a + l.cents, 0);
    const out = g.links.filter((l) => l.source === n.key).reduce((a, l) => a + l.cents, 0);
    if (into > 0) expect(into, `${n.key} in`).toBe(n.cents);
    if (out > 0) expect(out, `${n.key} out`).toBe(n.cents);
    expect(into > 0 || out > 0, `${n.key} is connected`).toBe(true);
  }
}

const shape = (m: FlowModel) => ({
  sources: Object.fromEntries(m.sources.map((s) => [s.key, s.cents])),
  buckets: Object.fromEntries(m.buckets.map((b) => [b.key, b.cents])),
  total: m.totalCents,
});

describe('the Flow balances to the cent (V1)', () => {
  it('draws an ordinary month gross, with credits as their own source', async () => {
    const { data, model } = await flowFor(MONTHS.may);
    expect(data.creditsCents).toBe(2000 + 222);
    // Reimbursement only took money back: nothing to draw, credit counted once.
    expect(data.categories.map((c) => [c.category_name, c.necessity, c.total_cents, c.credit_cents])).toEqual([
      ['Rent', 'required', 200000, 0], ['Groceries', 'required', 30000, 2000],
      ['Restaurants', 'discretionary', 15000, 0], ['Groceries Bulk', 'required', 7000, 0],
      ['Groceries', 'discretionary', 5000, 0],
    ]);
    expect(shape(model!)).toEqual({
      sources: { income: 500000, credits: 2222 },
      buckets: { required: 237000, discretionary: 20000, invested: 100000, leftover: 145222 },
      total: 502222,
    });
    expectBalanced(model!);
  });

  it('draws the shortfall from savings when spending outruns income', async () => {
    const { model } = await flowFor(MONTHS.june);
    expect(shape(model!)).toEqual({
      sources: { income: 100000, savings: 105000 },
      buckets: { required: 200000, discretionary: 5000 },
      total: 205000,
    });
    expectBalanced(model!);
  });

  it('draws a month with no income entirely from savings', async () => {
    const { model } = await flowFor(MONTHS.july);
    expect(shape(model!)).toEqual({ sources: { savings: 4000 }, buckets: { required: 4000 }, total: 4000 });
    expectBalanced(model!);
  });

  it('draws money out of investments as a source, not negative investing', async () => {
    const { model } = await flowFor(MONTHS.august);
    expect(shape(model!)).toEqual({
      sources: { investments: 50000 },
      buckets: { required: 20000, leftover: 30000 },
      total: 50000,
    });
    expectBalanced(model!);
  });

  it('has nothing to draw when no money moved', async () => {
    expect(buildFlow(await q.getFlow('2026-03-01', '2026-03-31'))).toBeNull();
  });
});

describe('gross minus credits is what the app already reports', () => {
  it('matches v_monthly_cashflow for every month, per bucket', async () => {
    const views = await sql<{ month: string; required_cents: number | null; discretionary_cents: number | null }[]>`
      SELECT month::text, required_cents, discretionary_cents FROM v_monthly_cashflow ORDER BY month`;
    expect(views.length).toBe(4);
    for (const v of views) {
      const end = new Date(Date.UTC(+v.month.slice(0, 4), +v.month.slice(5, 7), 0)).toISOString().slice(0, 10);
      const { data } = await flowFor([v.month, end]);
      for (const necessity of ['required', 'discretionary'] as const) {
        const rows = data.categories.filter((c) => c.necessity === necessity);
        const gross = rows.reduce((a, c) => a + c.total_cents, 0);
        // Credits in categories with nothing to draw still belong to a bucket.
        const credits = await sql<{ c: number }[]>`
          SELECT COALESCE(SUM(eff_amount_cents), 0)::bigint AS c FROM v_transactions
          WHERE counts_as_spending AND eff_amount_cents > 0 AND eff_necessity = ${necessity}
            AND eff_posted_date BETWEEN ${v.month}::date AND ${end}::date`;
        expect(gross - credits[0].c, `${v.month} ${necessity}`).toBe(v[`${necessity}_cents`] ?? 0);
      }
    }
  });
});

describe('a category opens to the same number (V2)', () => {
  it("opens each of May's Flow rows on exactly its figures", async () => {
    const { data } = await flowFor(MONTHS.may);
    for (const c of data.categories) {
      // What registerHref carries and the register page maps: the category
      // itself (not its subcategories) and the bucket's necessity.
      const totals = await q.getTransactionTotals({
        leafCategoryIds: [c.category_id!], necessity: [c.necessity], from: MONTHS.may[0], to: MONTHS.may[1],
      });
      expect(totals, `${c.category_name} (${c.necessity})`).toMatchObject({ spent_cents: c.total_cents, credit_cents: c.credit_cents });
    }
  });

  it("opens each of Cashflow's net figures on a register whose net is that figure", async () => {
    // Cashflow's list is net (a refund reduces its category); the register
    // prints spent, credits and, when there are credits, the net between.
    const rows = await q.getCategoryBreakdownRange(MONTHS.may[0], MONTHS.may[1]);
    const groceries = rows.find((r) => r.category_name === 'Groceries' && r.necessity === 'required');
    expect(groceries?.total_cents).toBe(30000 - 2000);
    for (const r of rows) {
      const t = await q.getTransactionTotals({
        leafCategoryIds: [r.category_id!], necessity: [r.necessity], from: MONTHS.may[0], to: MONTHS.may[1],
      });
      expect(t.spent_cents - t.credit_cents, `${r.category_name} (${r.necessity})`).toBe(r.total_cents);
    }
  });

  it('needs both: the category alone, or with its subcategories, is a different number', async () => {
    const may = { from: MONTHS.may[0], to: MONTHS.may[1] };
    // Groceries' required figure in the Flow is 300.00; the looser filters are not.
    expect((await q.getTransactionTotals({ ...may, leafCategoryIds: [cat.Groceries], necessity: ['required'] })).spent_cents).toBe(30000);
    expect((await q.getTransactionTotals({ ...may, leafCategoryIds: [cat.Groceries] })).spent_cents).toBe(35000);
    expect((await q.getTransactionTotals({ ...may, categoryIds: [cat.Groceries] })).spent_cents).toBe(42000);
  });

  it('totals every matching row, not just the page the register loads', async () => {
    const all = { from: '2026-05-01', to: '2026-08-31' };
    const page = await q.getTransactions({ ...all, limit: 2 });
    expect(page.length).toBe(2);
    expect(await q.getTransactionTotals({ ...all, limit: 2 })).toEqual(await q.getTransactionTotals(all));
    expect((await q.getTransactionTotals(all)).spent_cents).toBe(
      200000 + 30000 + 15000 + 5000 + 7000 // May
      + 200000 + 5000 + 4000 + 20000);     // June, July, August
  });

  it('counts the same rows it lists, whatever the filter', async () => {
    const filters = [
      { necessity: ['required'] }, { costType: ['variable'] }, { includeTransfers: false },
      { necessity: ['discretionary'], includeVoided: true },
    ];
    for (const f of filters) {
      const rows = await q.getTransactions({ ...f, limit: 1000 });
      expect(await q.countTransactions(f), JSON.stringify(f)).toBe(rows.length);
    }
  });
});

describe('subcategories, at every level (V1)', () => {
  it('splits a parent into its subcategories and General', async () => {
    const { model } = await flowFor(MONTHS.may);
    const required = model!.buckets.find((b) => b.key === 'required')!;
    const groceries = required.categories.find((c) => c.name === 'Groceries')!;
    expect(groceries.cents).toBe(30000 + 7000);
    expect(groceries.children.map((k) => [k.name, k.general, k.cents])).toEqual([
      ['Groceries Bulk', false, 7000], ['General', true, 30000],
    ]);
    // In the other bucket the parent has only its own rows: nothing to split.
    const party = model!.buckets.find((b) => b.key === 'discretionary')!.categories.find((c) => c.name === 'Groceries')!;
    expect(party.children).toEqual([]);
    for (const month of Object.values(MONTHS)) {
      const { model: m } = await flowFor(month);
      if (m) { expectBalanced(m); expectGraphBalanced(flowGraph(m, { from: month[0], to: month[1] })); }
    }
  });

  it('colours a category by its group, in the taxonomy\'s order', async () => {
    // The seeded groups that hold spending, in sort order; income and
    // transfers take no slot.
    expect(await q.getGroupSlots()).toEqual({
      Housing: 1, Transportation: 2, Food: 3, Health: 4, Lifestyle: 5, Financial: 6,
    });
    const { model } = await flowFor(MONTHS.may);
    const slot = (name: string) => model!.buckets.flatMap((b) => b.categories).find((c) => c.name === name)!.slot;
    expect([slot('Rent'), slot('Groceries'), slot('Restaurants')]).toEqual([1, 3, 3]);
  });
});

describe('every node opens its own rows (V2)', () => {
  let categories: CategoryWithGroup[];
  beforeAll(async () => { categories = await q.getCategories(); });

  /** Opens a link the way the register page does, and totals what it selects. */
  async function open(href: string) {
    const params = new URL(href, 'http://ledger').searchParams;
    const { filters } = registerView((k) => params.get(k) ?? undefined, categories);
    return q.getTransactionTotals(filters);
  }

  /** The figure a node shows, in the register's own terms. */
  async function expectLanding(g: FlowGraph) {
    let checked = 0;
    for (const n of g.nodes) {
      const href = n.rows ?? (n.action?.type === 'rows' ? n.action.href : undefined);
      if (!href) continue;
      const t = await open(href);
      const landed = n.key === 'source:income' ? t.income_cents
        : n.key === 'source:credits' ? t.credit_cents
        : n.key === 'source:investments' ? -t.invested_cents
        : n.key === 'bucket:invested' ? t.invested_cents
        : t.spent_cents;
      expect(landed, `${n.key} → ${href}`).toBe(n.cents);
      checked++;
    }
    return checked;
  }

  it('in the main Flow, for every month', async () => {
    for (const month of Object.values(MONTHS)) {
      const { model } = await flowFor(month);
      const g = flowGraph(model!, { from: month[0], to: month[1] }, new Set(['bucket:required', 'bucket:discretionary']));
      expect(await expectLanding(g)).toBeGreaterThan(0);
    }
  });

  it("in a category's own Flow, down to the merchant", async () => {
    const rows = await q.getCategoryFlow(cat.Groceries, ...MONTHS.may);
    const c = buildCategoryFlow({ id: cat.Groceries, name: 'Groceries', group: 'Food', slot: 3 }, rows)!;
    expect(c.cents).toBe(30000 + 5000 + 7000);
    expect(c.buckets.map((b) => [b.key, b.cents])).toEqual([['required', 37000], ['discretionary', 5000]]);
    expect(c.leaves.map((l) => [l.name, l.cents])).toEqual([['Groceries Bulk', 7000], ['General', 35000]]);
    // The grocer is one merchant across both buckets, and its refund is one
    // of its three transactions — counted, but not in the gross.
    expect(c.leaves[1].merchants.map((m) => [m.name, m.cents, m.creditCents, m.txnCount]))
      .toEqual([['Grocer', 35000, 2000, 3]]);
    const g = categoryGraph(c, { from: MONTHS.may[0], to: MONTHS.may[1] });
    expectGraphBalanced(g);
    expect(await expectLanding(g)).toBe(g.nodes.length);
  });

  it('a subcategory looks inside itself, straight to merchants', async () => {
    const rows = await q.getCategoryFlow(cat['Groceries Bulk'], ...MONTHS.may);
    const c = buildCategoryFlow({ id: cat['Groceries Bulk'], name: 'Groceries Bulk', group: 'Food', slot: 3 }, rows)!;
    expect(c.split).toBe(false);
    expect(c.leaves.map((l) => [l.name, l.merchants.map((m) => m.name)])).toEqual([['Groceries Bulk', ['WAREHOUSE CLUB']]]);
    expectGraphBalanced(categoryGraph(c, { from: MONTHS.may[0], to: MONTHS.may[1] }));
  });
});

describe('folding and ordering what is drawn', () => {
  /** Ten categories across three groups in one bucket, and one parent with six subcategories. */
  const wide: FlowInput = {
    incomeCents: 1_000_000, investedCents: 0, creditsCents: 0,
    groupSlots: { Housing: 1, Food: 3, Lifestyle: 5 },
    categories: [
      ...Array.from({ length: 10 }, (_, i) => ({
        category_id: `c${i}`, category_name: `Cat ${i}`, category_group_name: ['Housing', 'Food', 'Lifestyle'][i % 3],
        necessity: 'discretionary', total_cents: (10 - i) * 1000, credit_cents: 0, txn_count: 1,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        category_id: `s${i}`, category_name: `Sub ${i}`, category_group_name: 'Food', parent_id: 'p', parent_name: 'Parent',
        necessity: 'required', total_cents: (i + 1) * 500, credit_cents: 0, txn_count: 1,
      })),
    ],
  };
  const period = { from: '2026-05-01', to: '2026-05-31' };

  it('folds the smallest categories into one node that keeps their total', () => {
    const g = flowGraph(buildFlow(wide)!, period);
    const disc = g.nodes.filter((n) => n.column === 3 && g.links.some((l) => l.source === 'bucket:discretionary' && l.target === n.key));
    expect(disc.length).toBe(MAX_CATEGORIES + 1);
    const more = disc.find((n) => n.kind === 'more')!;
    expect(more.cents).toBe(4000 + 3000 + 2000 + 1000);
    expect(more.action).toEqual({ type: 'expand', key: 'bucket:discretionary' });
    expectGraphBalanced(g);
  });

  it('unfolds a bucket, and a category, on request', () => {
    const g = flowGraph(buildFlow(wide)!, period, new Set(['bucket:discretionary', 'cat:required:p']));
    expect(g.nodes.filter((n) => n.kind === 'more')).toEqual([]);
    expect(g.nodes.filter((n) => n.kind === 'subcategory').length).toBe(6);
    expectGraphBalanced(g);
  });

  it('runs each bucket by group, then by amount, so colours band together', () => {
    const g = flowGraph(buildFlow(wide)!, period, new Set(['bucket:discretionary']));
    const disc = g.nodes.filter((n) => n.column === 3 && n.key.startsWith('cat:discretionary'))
      .sort((a, b) => a.order - b.order);
    const slots = disc.map((n) => (n.tone.kind === 'group' ? n.tone.slot : null));
    expect(slots).toEqual([...slots].sort((a, b) => (a ?? 99) - (b ?? 99)));
    expect(disc.map((n) => n.name)).toEqual(['Cat 0', 'Cat 3', 'Cat 6', 'Cat 9', 'Cat 1', 'Cat 4', 'Cat 7', 'Cat 2', 'Cat 5', 'Cat 8']);
  });
});
