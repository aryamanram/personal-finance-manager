/**
 * Template for your own categorization rules.
 *
 *   cp scripts/rules.example.ts private/my-rules.ts
 *   # edit to match your real merchants, then:
 *   npx tsx private/my-rules.ts && npm run recategorize
 *
 * Keep the real thing in private/ — it is gitignored. Rule patterns name your
 * employer, your landlord and the places you shop, which is personal data you
 * do not want in a public repository.
 *
 * To see what needs a rule:
 *   psql -c "SELECT raw_description, count(*) FROM v_transactions
 *            WHERE category_name = 'Uncategorized'
 *            GROUP BY 1 ORDER BY 2 DESC"
 */
import postgres from 'postgres';
import { loadEnv } from './env.js';
import { pgTypes } from '../src/lib/pg-types.js';

loadEnv();
const sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {}, types: pgTypes });

interface RuleSpec {
  name: string;
  priority: number;       // lower runs first; first match wins
  regex: string;          // matched against raw_description, case-insensitive
  category: string;       // must be an existing category name
  costType?: 'fixed' | 'variable';
  necessity?: 'required' | 'discretionary' | 'income' | 'transfer' | 'investment';
}

/**
 * Suggested priority bands:
 *   10-19  transfers and card payments
 *   20-29  income
 *   30-39  fixed required
 *   40-59  variable required
 *   60-89  discretionary
 *
 * WARNING on transfer rules: the Credit Card Payment and Account Transfer
 * categories carry necessity='transfer', so anything they match leaves your
 * spending totals ENTIRELY. A pattern like /AUTOPAY/ will happily swallow
 * "CITY UTILITIES AUTOPAY" and make that bill disappear rather than merely
 * miscategorizing it. Name the card or the transfer explicitly.
 */
const RULES: RuleSpec[] = [
  // --- Transfers -----------------------------------------------------------
  { name: 'Card payment (out)', priority: 10,
    regex: 'Payment to Chase card ending', category: 'Credit Card Payment' },
  { name: 'Card payment (in)', priority: 10,
    regex: 'Payment Thank You', category: 'Credit Card Payment' },

  // --- Income --------------------------------------------------------------
  { name: 'Payroll', priority: 20, regex: 'YOUR EMPLOYER PAYROLL', category: 'Paycheck' },
  { name: 'Bank interest', priority: 21, regex: '^INTEREST PAYMENT',
    category: 'Interest & Dividends' },

  // --- Fixed required ------------------------------------------------------
  { name: 'Rent', priority: 30, regex: 'YOUR LANDLORD', category: 'Rent' },

  // --- Variable required ---------------------------------------------------
  { name: 'Gas', priority: 40, regex: 'SHELL|CHEVRON|COSTCO GAS', category: 'Gas' },
  { name: 'Groceries', priority: 41,
    regex: 'TRADER JOE|WHOLE FOODS|COSTCO WHSE|SAFEWAY', category: 'Groceries' },

  // Cash withdrawn IS an expenditure — it left the account — but where it went
  // is not traceable. Its own category keeps it in the spending totals while
  // staying honest that the ledger cannot say what it bought.
  { name: 'ATM cash', priority: 45,
    regex: 'ATM WITHDRAWAL|NON-CHASE ATM WITHDRAW|CASH WITHDRAWAL',
    category: 'Cash Withdrawn' },

  // --- Discretionary -------------------------------------------------------
  // SUBCATEGORIES: a subcategory is an ordinary category with a parent, so a
  // rule targets it by name exactly like any other. Prefer the specific one —
  // totals roll up to the parent automatically (v_transactions.rollup_*), so
  // naming 'Streaming & Video' still counts toward Subscriptions, while
  // naming 'Subscriptions' throws away detail you cannot recover later.
  //
  // Order matters: first match wins, so put the specific patterns above the
  // catch-all. A bare 'Subscriptions' rule at the same priority would swallow
  // everything below it.
  { name: 'Streaming', priority: 60,
    regex: 'NETFLIX|HULU|DISNEYPLUS|YouTubePremi|HELP\\.MAX\\.COM',
    category: 'Streaming & Video' },
  { name: 'Music', priority: 60, regex: 'SPOTIFY|APPLE MUSIC|TIDAL',
    category: 'Music & Audio' },
  { name: 'AI tools', priority: 60, regex: 'OPENAI|ANTHROPIC|CURSOR|CODEIUM',
    category: 'AI Tools' },
  { name: 'Hosting', priority: 60, regex: 'HOSTINGER|NAMECHEAP|CLOUDFLARE|DIGITALOCEAN',
    category: 'Hosting & Domains' },
  { name: 'Creator support', priority: 60, regex: 'PATREON|KO-FI|SUBSTACK',
    category: 'Creator Support' },
  // The catch-all, LAST: anything recurring that no rule above claimed. It
  // lands on the parent and shows up in the register as needing a human.
  { name: 'Subscriptions (other)', priority: 69,
    regex: 'SUBSCRIPTION|RECURRING', category: 'Subscriptions' },
  { name: 'Restaurants', priority: 70, regex: 'TST\\*|SQ \\*|DOORDASH', category: 'Restaurants' },
];

/** Creates or updates the example categorization rules in the database. */
async function main() {
  /** Resolves a category name to the identifier required by a rule. */
  const cat = async (name: string) => {
    const [c] = await sql<{ id: string }[]>`SELECT id FROM categories WHERE name = ${name} LIMIT 1`;
    if (!c) throw new Error(`No category named "${name}"`);
    return c.id;
  };

  let created = 0;
  let updated = 0;

  for (const r of RULES) {
    const categoryId = await cat(r.category);
    const [existing] = await sql<{ id: string }[]>`
      SELECT id FROM rules WHERE name = ${r.name} LIMIT 1`;

    if (existing) {
      await sql`
        UPDATE rules SET
          priority = ${r.priority}, match_regex = ${r.regex},
          set_category_id = ${categoryId},
          set_cost_type = ${r.costType ?? null},
          set_necessity = ${r.necessity ?? null},
          is_active = TRUE
        WHERE id = ${existing.id}`;
      updated++;
    } else {
      await sql`
        INSERT INTO rules (name, priority, match_regex, set_category_id,
                           set_cost_type, set_necessity)
        VALUES (${r.name}, ${r.priority}, ${r.regex}, ${categoryId},
                ${r.costType ?? null}, ${r.necessity ?? null})`;
      created++;
    }
  }

  console.log(`✓ ${created} rules created, ${updated} updated`);
  console.log('  Run: npm run recategorize');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => sql.end());
