import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import {
  getTransactions, countTransactions, getCategories, getAccounts, getGroupSlots,
} from '@/lib/queries';
import { TransactionTable } from '@/components/TransactionTable';
import { CategoryDefaults } from '@/components/CategoryDefaults';
import { Figure } from '@/components/Figure';
import { formatCentsCompact } from '@/money';
import { formatMonthShort } from '@/lib/format-date';
import { categoryColors } from '@/lib/palette';
import { Card } from '@/components/Card';
import { REGISTER_BATCH } from '@/lib/register-filters';

export const dynamic = 'force-dynamic';

/** Renders a category's spending trend, defaults, and transactions. */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [category] = await sql<
    {
      id: string; name: string; group_name: string;
      default_cost_type: 'fixed' | 'variable';
      default_necessity: string;
    }[]
  >`
    SELECT c.id, c.name, g.name AS group_name, c.default_cost_type, c.default_necessity
    FROM categories c JOIN category_groups g ON g.id = c.group_id
    WHERE c.id = ${id}`;

  if (!category) notFound();

  // The rows and their count read the same filter, and so does every batch
  // the register loads as it scrolls.
  const filter = { categoryIds: [id] };
  const [trend, transactions, total, categories, accounts, groupSlots] = await Promise.all([
    sql<{ month: string; total_cents: number; n: number }[]>`
      SELECT date_trunc('month', eff_posted_date)::date AS month,
             -SUM(eff_amount_cents)::bigint AS total_cents,
             count(*)::int AS n
      FROM v_transactions
      WHERE category_id = ${id} AND counts_as_spending
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
    getTransactions({ ...filter, limit: REGISTER_BATCH }),
    countTransactions(filter),
    getCategories(),
    getAccounts(),
    getGroupSlots(),
  ]);
  // Its own shade of its group's colour, the same as in the Flow and the
  // register (V10).
  const colors = categoryColors(categories, groupSlots);
  const slot = groupSlots[category.group_name] ?? null;
  const colour = colors[category.id] ?? (slot ? `var(--color-group-${slot})` : 'var(--color-chart-strong)');

  const months = [...trend].reverse();
  const peak = Math.max(...months.map((m) => m.total_cents), 1);
  const average = months.length
    ? Math.round(months.reduce((a, m) => a + m.total_cents, 0) / months.length)
    : 0;

  return (
    <div className="space-y-6">
      <header>
        <Link href="/transactions" className="eyebrow transition-colors hover:text-ink-dim">
          ← Register
        </Link>
        <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
          <span aria-hidden className="swatch h-3 w-3" style={{ background: colour }} />
          {category.name}
          <span className="text-sm font-normal text-ink-faint">{category.group_name}</span>
        </h1>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          label="Monthly"
          action={
            <span className="text-xs text-ink-faint">
              average <Figure cents={average} tone="neutral" showCents={false} />
            </span>
          }
        >
          {/* A bar per month, drawn from the values themselves — no chart
              library needed for twelve numbers. */}
          <ul className="space-y-1.5">
            {months.map((m) => (
              <li key={m.month} className="flex items-center gap-3 text-xs">
                <span className="figure w-16 shrink-0 text-ink-faint">
                  {formatMonthShort(m.month)}
                </span>
                <span className="h-4 flex-1 overflow-hidden rounded-[3px] bg-well">
                  <span
                    className="block h-full"
                    style={{ width: `${(m.total_cents / peak) * 100}%`, background: colour }}
                  />
                </span>
                <span className="figure w-20 shrink-0 text-right text-ink-dim">
                  {formatCentsCompact(m.total_cents)}
                </span>
                <span className="figure w-8 shrink-0 text-right text-ink-faint">{m.n}</span>
              </li>
            ))}
          </ul>
          {months.length === 0 && (
            <p className="py-8 text-sm text-ink-faint">No spending in this category yet.</p>
          )}
        </Card>

        <Card label="Defaults">
          <p className="text-xs leading-relaxed text-ink-faint">
            Inherited by every transaction in this category. A per-transaction
            override still wins.
          </p>
          <CategoryDefaults
            categoryId={category.id}
            costType={category.default_cost_type}
            necessity={category.default_necessity}
          />
        </Card>
      </div>

      <section aria-label="Transactions">
        <TransactionTable
          initial={transactions}
          categories={categories}
          accounts={accounts}
          total={total}
          filters={filter}
          groupSlots={groupSlots}
          colors={colors}
        />
      </section>
    </div>
  );
}
