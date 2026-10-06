/**
 * The deterministic guesser (DESIGN.md §8). No model, no network, no cost.
 *
 * Every row it touches is still a GUESS — a human confirms or corrects each
 * one — so the goal is not certainty. It is to put the right category in
 * front of the reviewer as often as possible, and to say why, so a wrong
 * guess is quick to spot.
 *
 * The strongest evidence is the owner's own past decisions. The ledger is
 * fully hand-categorised, so "what did I file this merchant as last time?" is
 * a better answer than any generic table. Steps, first answer wins:
 *
 *   1. same merchant, same direction         — the last decision on it
 *   2. structural pattern                    — ATM, fee, card payment, transfer
 *   3. shared name, two or more words        — "costco gas glenview" ~ "costco gas chicago"
 *   4. keyword                               — a well-known chain
 *   5. shared name, one word                 — "united" ~ "united airlines"
 *   6. same payment rail                     — most "zelle to …" were restaurants
 *
 * Names are compared by LEADING words because bank descriptors put the
 * merchant first and the location last. Two merchants in the same city share
 * a trailing word, never a leading one, so a leading prefix does not confuse
 * "a bar in Chicago" with "a gas station in Chicago".
 *
 * Direction matters throughout: the same rail carries spending one way and
 * reimbursement the other. A card refund (money IN on a credit account) may
 * learn from the merchant's purchases, since a refund belongs in the category
 * it reverses.
 */
import { merchantKey } from '@/ingest/fingerprint';
import type { AccountType } from '@/lib/types';
import { STRUCTURAL, KEYWORD, firstMatch, type Direction, type Pattern } from './heuristics';

/** A human decision the guesser may learn from. */
export interface Decision {
  rawDescription: string;
  amountCents: number;
  accountType: AccountType;
  categoryId: string;
  postedDate: string; // ISO yyyy-mm-dd
}

/** A row wanting a guess. */
export interface Candidate {
  rawDescription: string;
  amountCents: number;
  accountType: AccountType;
}

export type GuessMethod = 'history' | 'pattern';

/** Which step answered, in precedence order. */
export type GuessStep = 'merchant' | 'structural' | 'name' | 'keyword' | 'word' | 'rail';

export interface Guess {
  categoryId: string;
  /** 'history' learned from a human decision; 'pattern' from a built-in table. */
  method: GuessMethod;
  step: GuessStep;
  /** 0–1. Orders how much to trust it; never a reason to skip review. */
  confidence: number;
  /** One line for the reviewer: why this category. */
  reason: string;
}

/**
 * Words that describe HOW money moved rather than WHO it went to. They are
 * dropped before names are compared, so "zelle payment to" in front of two
 * different people is not mistaken for a shared merchant.
 */
const GENERIC = new Set([
  'a', 'at', 'in', 'of', 'on', 'the', 'and', 'to', 'from', 'for', 'with',
  'payment', 'payments', 'pmt', 'purchase', 'web', 'www', 'com', 'online', 'mobile',
  'transfer', 'xfer', 'inst', 'pos', 'debit', 'credit', 'card', 'recurring', 'ach',
  'deposit', 'orig', 'co', 'name', 'entry', 'descr', 'sec', 'ppd', 'ccd', 'id',
  'inc', 'llc', 'ltd', 'corp', 'us', 'usa', 'help', 'bill',
  'zelle', 'venmo', 'paypal', 'pypl', 'splitwise', 'sq', 'tst', 'wl',
]);

/** Words that name a payment rail rather than a payee. */
const RAIL_WORDS = new Set(['zelle', 'venmo', 'paypal', 'pypl', 'splitwise']);

/** Merchant words: generic words and reference codes (anything with a digit) removed. */
export function nameWords(raw: string): string[] {
  return merchantKey(raw)
    .split(' ')
    .filter((w) => w.length > 0 && !GENERIC.has(w) && !/\d/.test(w));
}

function directionOf(amountCents: number): Direction {
  return amountCents > 0 ? 'in' : 'out';
}

/**
 * The rail a row travelled, as the whole run of generic words it opens with:
 * "paypal inst xfer" and "paypal purchase" are different rails that happen to
 * share a company, and they carry different kinds of spending. Null unless
 * the run names an actual rail.
 */
export function railOf(raw: string): string | null {
  const run: string[] = [];
  for (const w of merchantKey(raw).split(' ')) {
    if (!GENERIC.has(w)) break;
    run.push(w);
  }
  return run.some((w) => RAIL_WORDS.has(w)) ? run.join(' ') : null;
}

/** Number of leading words two lists share. */
function sharedPrefix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

interface Learned {
  words: string[];
  signature: string;
  direction: Direction;
  rail: string | null;
  categoryId: string;
  postedDate: string;
}

export interface GuessModel {
  learned: Learned[];
  /** category name → id, for the pattern tables. Archived categories absent. */
  idByName: Map<string, string>;
  /** category id → name, for writing reasons. */
  nameById: Map<string, string>;
  /** category id → its parent's id, for subcategories. */
  parentById: Map<string, string>;
}

/** Builds the guesser's memory from human decisions and the live category list. */
export function buildModel(
  decisions: Decision[],
  categories: { id: string; name: string; parent_id?: string | null }[],
): GuessModel {
  const learned = decisions.map((d) => {
    const words = nameWords(d.rawDescription);
    return {
      words,
      signature: words.join(' '),
      direction: directionOf(d.amountCents),
      rail: railOf(d.rawDescription),
      categoryId: d.categoryId,
      postedDate: d.postedDate,
    };
  });
  return {
    learned,
    idByName: new Map(categories.map((c) => [c.name, c.id])),
    nameById: new Map(categories.map((c) => [c.id, c.name])),
    parentById: new Map(
      categories.filter((c) => c.parent_id).map((c) => [c.id, c.parent_id as string]),
    ),
  };
}

/**
 * The winner among a set of past decisions: the most recent one. A merchant
 * filed as a parent category before a subcategory existed, then as the
 * subcategory since, should guess the subcategory — the later decision is the
 * current taxonomy. Returns how many of the set agree, for confidence.
 */
function latest(set: Learned[]): { categoryId: string; agree: number; total: number } {
  let best = set[0];
  for (const l of set) if (l.postedDate > best.postedDate) best = l;
  const agree = set.filter((l) => l.categoryId === best.categoryId).length;
  return { categoryId: best.categoryId, agree, total: set.length };
}

/**
 * A decision filed at a parent is not a vote against its own subcategory —
 * it is the same answer, less specific, usually from before the subcategory
 * existed. Where a set holds both, the parent's votes go to the child.
 * Only when exactly one child of that parent appears; two children leave the
 * parent votes alone rather than pick between them.
 */
function specialise(set: Learned[], parentById: Map<string, string>): Learned[] {
  const childrenOf = new Map<string, Set<string>>();
  for (const l of set) {
    const p = parentById.get(l.categoryId);
    if (!p) continue;
    const kids = childrenOf.get(p) ?? new Set<string>();
    kids.add(l.categoryId);
    childrenOf.set(p, kids);
  }
  return set.map((l) => {
    const kids = childrenOf.get(l.categoryId);
    return kids && kids.size === 1 ? { ...l, categoryId: [...kids][0] } : l;
  });
}

/** The category most of a set was filed as, ties to the most recent. */
function majority(set: Learned[]): { categoryId: string; agree: number; total: number } {
  const counts = new Map<string, { n: number; last: string }>();
  for (const l of set) {
    const c = counts.get(l.categoryId) ?? { n: 0, last: '' };
    c.n++;
    if (l.postedDate > c.last) c.last = l.postedDate;
    counts.set(l.categoryId, c);
  }
  let bestId = '';
  let best = { n: 0, last: '' };
  for (const [id, c] of counts) {
    if (c.n > best.n || (c.n === best.n && c.last > best.last)) { bestId = id; best = c; }
  }
  return { categoryId: bestId, agree: best.n, total: set.length };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Directions whose history may inform this row. A refund on a card may learn
 * from the purchases it reverses; nothing else crosses direction.
 */
function directionsFor(c: Candidate): Direction[] {
  const d = directionOf(c.amountCents);
  return d === 'in' && c.accountType === 'credit' ? ['in', 'out'] : [d];
}

/** Guesses a category for one row, or returns null when nothing fits. */
export function guess(c: Candidate, model: GuessModel): Guess | null {
  const words = nameWords(c.rawDescription);
  const signature = words.join(' ');
  const direction = directionOf(c.amountCents);
  const dirs = directionsFor(c);
  const name = (id: string) => model.nameById.get(id) ?? '?';
  const shown = (ws: string[]) => ws.join(' ');

  const fromPattern = (p: Pattern | null, step: GuessStep, confidence: number): Guess | null => {
    if (!p) return null;
    const id = model.idByName.get(p.category);
    return id ? { categoryId: id, method: 'pattern', step, confidence, reason: p.label } : null;
  };

  // 1. The same merchant, decided before.
  if (signature) {
    for (const d of dirs) {
      const same = specialise(
        model.learned.filter((l) => l.direction === d && l.signature === signature),
        model.parentById,
      );
      if (same.length === 0) continue;
      const w = latest(same);
      return {
        categoryId: w.categoryId,
        method: 'history',
        step: 'merchant',
        confidence: round2((w.agree / w.total) * (w.total > 1 ? 0.95 : 0.85)),
        reason: `${w.agree} of ${w.total} past "${signature}" → ${name(w.categoryId)}`,
      };
    }
  }

  // 2. The description says what the money is.
  const structural = fromPattern(firstMatch(STRUCTURAL, c.rawDescription, direction, c.accountType), 'structural', 0.85);
  if (structural) return structural;

  // 3 and 5. A merchant sharing leading name words. Two words is a strong
  // match; one word is weaker than a known chain, so it waits until after
  // the keyword table.
  let byPrefix: { n: number; w: ReturnType<typeof majority> } | null = null;
  if (words.length > 0) {
    for (const d of dirs) {
      let bestN = 0;
      let best: Learned[] = [];
      for (const l of model.learned) {
        if (l.direction !== d) continue;
        const n = sharedPrefix(words, l.words);
        if (n === 0 || n < bestN) continue;
        if (n > bestN) { bestN = n; best = []; }
        best.push(l);
      }
      if (bestN > 0) { byPrefix = { n: bestN, w: majority(specialise(best, model.parentById)) }; break; }
    }
  }
  const prefixGuess = (step: GuessStep, confidence: number): Guess | null =>
    byPrefix && {
      categoryId: byPrefix.w.categoryId,
      method: 'history',
      step,
      confidence: round2(confidence * (byPrefix.w.agree / byPrefix.w.total)),
      reason: `like past "${shown(words.slice(0, byPrefix.n))} …" → ${name(byPrefix.w.categoryId)}` +
        (byPrefix.w.total > 1 ? ` (${byPrefix.w.agree} of ${byPrefix.w.total})` : ''),
    };

  if (byPrefix && byPrefix.n >= 2) return prefixGuess('name', 0.75);

  // 4. A well-known chain.
  const keyword = fromPattern(firstMatch(KEYWORD, c.rawDescription, direction, c.accountType), 'keyword', 0.6);
  if (keyword) return keyword;

  if (byPrefix) return prefixGuess('word', 0.55);

  // 6. Nothing about the payee is known, but the rail is: most money sent
  // by this rail in this direction went to one kind of thing.
  const rail = railOf(c.rawDescription);
  if (rail) {
    const same = model.learned.filter((l) => l.rail === rail && l.direction === direction);
    if (same.length > 0) {
      const w = majority(specialise(same, model.parentById));
      return {
        categoryId: w.categoryId,
        method: 'history',
        step: 'rail',
        confidence: round2(0.4 * (w.agree / w.total)),
        reason: `most "${rail} …" ${direction === 'in' ? 'received' : 'sent'} → ${name(w.categoryId)} (${w.agree} of ${w.total})`,
      };
    }
  }

  return null;
}
