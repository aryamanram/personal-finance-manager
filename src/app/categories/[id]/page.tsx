import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { getTransactions, getCategories, getAccounts } from '@/lib/queries';
import { TransactionTable } from '@/components/TransactionTable';
import { CategoryDefaults } from '@/components/CategoryDefaults';
import { Figure } from '@/components/Figure';
import { formatCentsCompact } from '@/money';
import { formatMonthShort } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

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

  const [trend, transactions, categories, accounts] = await Promise.all([
    sql<{ month: string; total_cents: number; n: number }[]>`
      SELECT date_trunc('month', eff_posted_date)::date AS month,
             -SUM(eff_amount_cents)::bigint AS total_cents,
             count(*)::int AS n
      FROM v_transactions
      WHERE category_id = ${id} AND counts_as_spending
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
    getTransactions({ categoryIds: [id], limit: 200 }),
    getCategories(),
    getAccounts(),
  ]);

  const months = [...trend].reverse();
  const peak = Math.max(...months.map((m) => m.total_cents), 1);
  const average = months.length
    ? Math.round(months.reduce((a, m) => a + m.total_cents, 0) / months.length)
    : 0;

  return (
    <div className="space-y-10">
      <header>
        <Link href="/" className="eyebrow transition-colors hover:text-paper-dim">
          ← {category.group_name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{category.name}</h1>
      </header>

      <section className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="rule-b flex items-baseline justify-between pb-2">
            <h2 className="eyebrow">Monthly</h2>
            <span className="text-xs text-paper-faint">
              average <Figure cents={average} tone="neutral" showCents={false} />
            </span>
          </div>

          {/* A bar per month, drawn from the values themselves — no chart
              library needed for twelve numbers. */}
          <ul className="mt-4 space-y-1.5">
            {months.map((m) => (
              <li key={m.month} className="flex items-center gap-3 text-xs">
                <span className="figure w-16 shrink-0 text-paper-faint">
                  {formatMonthShort(m.month)}
                </span>
                <span className="h-4 flex-1 bg-ink-850">
                  <span
                    className="block h-full bg-out-dim"
                    style={{ width: `${(m.total_cents / peak) * 100}%` }}
                  />
                </span>
                <span className="figure w-20 shrink-0 text-right text-paper-dim">
                  {formatCentsCompact(m.total_cents)}
                </span>
                <span className="figure w-8 shrink-0 text-right text-paper-faint">{m.n}</span>
              </li>
            ))}
          </ul>
          {months.length === 0 && (
            <p className="py-8 text-sm text-paper-faint">No spending in this category yet.</p>
          )}
        </div>

        <div>
          <div className="rule-b pb-2">
            <h2 className="eyebrow">Defaults</h2>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-paper-faint">
            Inherited by every transaction in this category. A per-transaction
            override still wins.
          </p>
          <CategoryDefaults
            categoryId={category.id}
            costType={category.default_cost_type}
            necessity={category.default_necessity}
          />
        </div>
      </section>

      <section>
        <TransactionTable
          initial={transactions}
          categories={categories}
          accounts={accounts}
          total={transactions.length}
        />
      </section>
    </div>
  );
}
