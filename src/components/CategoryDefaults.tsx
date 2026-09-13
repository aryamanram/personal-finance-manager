'use client';

import { useState } from 'react';

/**
 * The two axes, editable inline (INGEST_NOTES.md §5).
 *   cost_type  — is this predictable?
 *   necessity  — can I cut it?
 * They cross independently; collapsing them into one toggle loses a question.
 */
const COST_TYPES = [
  { value: 'fixed', label: 'Fixed', hint: 'same every month' },
  { value: 'variable', label: 'Variable', hint: 'moves month to month' },
] as const;

const NECESSITIES = [
  { value: 'required', label: 'Required', hint: 'cannot cut' },
  { value: 'discretionary', label: 'Discretionary', hint: 'could cut' },
  { value: 'income', label: 'Income', hint: 'money in' },
  { value: 'transfer', label: 'Transfer', hint: 'between your accounts' },
  { value: 'investment', label: 'Investment', hint: 'committed, not spent' },
] as const;

export function CategoryDefaults({
  categoryId,
  costType,
  necessity,
}: {
  categoryId: string;
  costType: string;
  necessity: string;
}) {
  const [cost, setCost] = useState(costType);
  const [need, setNeed] = useState(necessity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, string>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/categories/${categoryId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? 'Could not save.');
        return;
      }
      // Totals shift when a default changes, so refresh the server components.
      window.location.reload();
    } catch {
      setError('Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-5">
      <Group
        label="Cost type"
        options={COST_TYPES}
        value={cost}
        disabled={saving}
        onChange={(v) => { setCost(v); void save({ default_cost_type: v }); }}
      />
      <Group
        label="Necessity"
        options={NECESSITIES}
        value={need}
        disabled={saving}
        onChange={(v) => { setNeed(v); void save({ default_necessity: v }); }}
      />
      {error && <p className="text-xs text-out">{error}</p>}
    </div>
  );
}

function Group({
  label, options, value, onChange, disabled,
}: {
  label: string;
  options: readonly { value: string; label: string; hint: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="eyebrow mb-2">{label}</legend>
      <div className="space-y-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-baseline gap-2 text-sm transition-colors ${
              value === o.value ? 'text-paper' : 'text-paper-faint hover:text-paper-dim'
            }`}
          >
            <input
              type="radio"
              name={label}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="accent-edited"
            />
            {o.label}
            <span className="text-xs text-paper-faint">{o.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
