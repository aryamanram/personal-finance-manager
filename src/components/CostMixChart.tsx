'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatCents, formatCentsCompact } from '@/money';
import type { MonthlyCashflow } from '@/lib/types';

/**
 * Fixed vs variable, twelve months. This is the forecasting axis: fixed costs
 * are the part of next month you already know (INGEST_NOTES.md §5).
 */
export function CostMixChart({ data }: { data: MonthlyCashflow[] }) {
  const rows = data.map((m) => ({
    month: new Date(`${m.month}T00:00:00`).toLocaleDateString('en-US', { month: 'short' }),
    fullMonth: new Date(`${m.month}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric',
    }),
    Fixed: m.fixed_cents ?? 0,
    Variable: m.variable_cents ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barCategoryGap="22%">
        <CartesianGrid stroke="var(--color-ink-700)" vertical={false} />
        <XAxis
          dataKey="month"
          stroke="var(--color-paper-faint)"
          tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-ink-700)' }}
        />
        <YAxis
          stroke="var(--color-paper-faint)"
          tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatCentsCompact(v)}
          width={52}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-ink-800)' }}
          contentStyle={{
            background: 'var(--color-ink-800)',
            border: '1px solid var(--color-ink-600)',
            borderRadius: 3,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--color-paper)', marginBottom: 4 }}
          labelFormatter={(_, p) => p?.[0]?.payload?.fullMonth ?? ''}
          formatter={(v, name) => [formatCents(Number(v)), String(name)]}
        />
        <Legend
          iconType="square"
          iconSize={9}
          wrapperStyle={{ fontSize: 11, color: 'var(--color-paper-dim)', paddingTop: 8 }}
        />
        {/* Fixed sits on the bottom: it is the floor you cannot move. */}
        <Bar dataKey="Fixed" stackId="a" fill="var(--color-out-dim)" />
        <Bar dataKey="Variable" stackId="a" fill="var(--color-out)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
