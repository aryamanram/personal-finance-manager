/**
 * LLM categorization fallback (DESIGN.md §8, step 3).
 *
 * Two things make this cheap and idempotent:
 *   - It batches distinct MERCHANTS, never transactions. A thousand Starbucks
 *     rows cost one merchant slot, not a thousand calls.
 *   - The answer is written to merchants.default_category_id, so the same
 *     merchant is never sent to the model twice.
 *
 * Model choice is Claude Haiku per DESIGN.md §4 — categorization is a cheap
 * classification task and this runs over every unknown merchant.
 *
 * Per §12, the model may only PICK from the existing category list. It cannot
 * propose new categories.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Sql } from 'postgres';

const MODEL = 'claude-haiku-4-5';
const BATCH_SIZE = 40;

export interface LlmCategorizeResult {
  merchantsExamined: number;
  merchantsAssigned: number;
  transactionsUpdated: number;
  skipped: 'no-api-key' | null;
  errors: string[];
}

interface CategoryChoice {
  id: string;
  name: string;
  group_name: string;
  default_necessity: string;
}

/** The model returns an array of these. Validated before anything is written. */
interface Assignment {
  merchant: string;
  category: string;
  confidence: number;
}

export async function categorizeWithLlm(
  sql: Sql,
  opts: { from?: string; to?: string; limit?: number; log?: (m: string) => void } = {},
): Promise<LlmCategorizeResult> {
  const log = opts.log ?? (() => {});
  const result: LlmCategorizeResult = {
    merchantsExamined: 0,
    merchantsAssigned: 0,
    transactionsUpdated: 0,
    skipped: null,
    errors: [],
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    // Not an error: the pipeline is designed to work without an API key, it
    // just leaves unknown merchants in Uncategorized.
    result.skipped = 'no-api-key';
    return result;
  }

  const categories = await sql<CategoryChoice[]>`
    SELECT c.id, c.name, g.name AS group_name, c.default_necessity::text
    FROM categories c JOIN category_groups g ON g.id = c.group_id
    WHERE NOT c.is_archived AND c.name <> 'Uncategorized'
    ORDER BY g.sort_order, c.sort_order, c.name`;

  // Merchants with no default, that actually have uncategorized transactions.
  const merchants = await sql<{ id: string; display_name: string; normalized_name: string; n: number }[]>`
    SELECT m.id, m.display_name, m.normalized_name, count(t.id)::int AS n
    FROM merchants m
    JOIN transactions t ON t.merchant_id = m.id
    WHERE m.default_category_id IS NULL
      AND NOT t.category_locked
      AND t.superseded_by_id IS NULL
      AND t.voided_at IS NULL
      AND (t.category_id IS NULL OR t.category_source IN ('unset', 'default'))
      ${opts.from ? sql`AND t.posted_date >= ${opts.from}::date` : sql``}
      ${opts.to ? sql`AND t.posted_date <= ${opts.to}::date` : sql``}
    GROUP BY m.id, m.display_name, m.normalized_name
    ORDER BY count(t.id) DESC
    LIMIT ${opts.limit ?? 200}`;

  result.merchantsExamined = merchants.length;
  if (merchants.length === 0) return result;

  const client = new Anthropic();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    const batch = merchants.slice(i, i + BATCH_SIZE);
    log(`  · asking about ${batch.length} merchants (${i + batch.length}/${merchants.length})`);

    try {
      const assignments = await askModel(client, batch.map((m) => m.display_name), categories);

      for (const a of assignments) {
        const merchant = batch.find(
          (m) => m.display_name.toLowerCase() === a.merchant.toLowerCase(),
        );
        const category = byName.get(a.category.toLowerCase());
        // The model may only pick from the list (§12). Anything else is dropped.
        if (!merchant || !category) continue;

        const confidence = Math.min(1, Math.max(0, a.confidence));

        // Cache the decision on the merchant so this is a one-time cost.
        await sql`
          UPDATE merchants SET default_category_id = ${category.id} WHERE id = ${merchant.id}`;

        // I4: never overwrite a human decision.
        const updated = await sql<{ id: string }[]>`
          UPDATE transactions SET
            category_id = ${category.id},
            category_source = 'llm',
            suggested_category_id = ${category.id},
            suggested_confidence = ${confidence}
          WHERE merchant_id = ${merchant.id}
            AND NOT category_locked
            AND superseded_by_id IS NULL
            AND voided_at IS NULL
            AND (category_id IS NULL OR category_source IN ('unset', 'default'))
            ${opts.from ? sql`AND posted_date >= ${opts.from}::date` : sql``}
            ${opts.to ? sql`AND posted_date <= ${opts.to}::date` : sql``}
          RETURNING id`;

        result.merchantsAssigned++;
        result.transactionsUpdated += updated.length;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Batch ${i / BATCH_SIZE + 1}: ${msg}`);
      log(`  ! ${msg}`);
    }
  }

  return result;
}

async function askModel(
  client: Anthropic,
  merchantNames: string[],
  categories: CategoryChoice[],
): Promise<Assignment[]> {
  const categoryList = categories
    .map((c) => `- ${c.name} (${c.group_name}, ${c.default_necessity})`)
    .join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system:
      'You categorize bank and credit-card merchant names for a personal finance tracker. ' +
      'You must choose a category from the provided list and never invent one. ' +
      'If a merchant is genuinely ambiguous, pick the closest fit and report low confidence.',
    messages: [{
      role: 'user',
      content:
        `Available categories:\n${categoryList}\n\n` +
        `Merchant names (these come from bank statements, so they may be abbreviated ` +
        `or contain location fragments):\n` +
        merchantNames.map((n) => `- ${n}`).join('\n') +
        `\n\nFor each merchant, pick the single best category from the list above.`,
    }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['assignments'],
          properties: {
            assignments: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['merchant', 'category', 'confidence'],
                properties: {
                  merchant: { type: 'string', description: 'exactly as given' },
                  category: {
                    type: 'string',
                    enum: categories.map((c) => c.name),
                  },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
          },
        },
      },
    },
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = JSON.parse(text) as { assignments?: Assignment[] };
  return Array.isArray(parsed.assignments) ? parsed.assignments : [];
}
