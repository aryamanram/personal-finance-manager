/**
 * A colour for every category: its group's hue, its own shade.
 *
 * The group palette (globals.css, group-1..8) says what KIND of thing money
 * was spent on. Within a group, each category takes a nearby shade of that
 * hue — Groceries and Restaurants are both orange, not the same orange — and
 * each subcategory is an offshoot of its parent: shades of the parent's hue
 * on its deeper side only, spread so they differ from each other. "Deeper" means further from
 * the page: darker on the light theme, lighter on the dark one, so a
 * subcategory never fades into the ground.
 *
 * Read from docs/design/tokens.json — which globals.css generates and a test
 * keeps in step — so the CSS stays the one place the palette is written.
 * Pure arithmetic: a category's colour depends on where it sits in the
 * taxonomy, never on a month's numbers, so it is the same on every page and
 * in every period (V10).
 */
import tokens from '../../docs/design/tokens.json';

type Theme = 'light' | 'dark';
type Lch = { l: number; c: number; h: number };

/**
 * What each theme's shades are checked against. The group's own colour clears
 * 3:1 (the token tests hold it); a shade clears SHADE_CONTRAST, which is
 * legal because no shade identifies anything alone — every node is labelled
 * and the table carries the same numbers (the dataviz relief rule).
 */
const SHADE_CONTRAST = 2.3;
const SURFACES: Record<Theme, string[]> = {
  light: [tokens.light.color.ground.$value, tokens.light.color.card.$value],
  dark: [tokens.dark.color.ground.$value, tokens.dark.color.card.$value],
};

/**
 * How a family spreads. Siblings take evenly spaced lightnesses across a band
 * around the group's colour — SIBLING_REACH either side, widened (inside what
 * the theme allows) until neighbours are at least MIN_STEP apart. The first
 * sibling sits nearest the group's own colour and the rest alternate outward,
 * lighter then darker, the same way in both themes. Subcategories do the same
 * on the deeper side of their parent only: from DEEPER past it, outward.
 */
const SIBLING_REACH = 0.12;
const CHILD_REACH = 0.1;
const DEEPER = 0.045;
const MIN_STEP = 0.045;
/** Depth kept free beyond the deepest sibling, so its offshoots still have room. */
const ROOM_FOR_OFFSHOOTS = 0.07;
/** A small turn of hue per step out, so a family is more than one ramp. */
const TURNS = [0, 6, 10, 4, 14, 8, 12, 16, 3, 9];

/**
 * Amber (edits), earned green and alert red are never chart colours, so a
 * shade turns its hue whichever way — or not at all — keeps it furthest from
 * them. Amber is given the widest berth: it is the one meaning the ledger
 * depends on. Alert red the narrowest: it is only ever text, beside words.
 */
const RESERVED_HUES: [hue: number, berth: number][] = [[72, 1.6], [150, 1], [27, 0.6]];

export interface PaletteCategory {
  id: string;
  name: string;
  group_name: string;
  parent_id: string | null;
  sort_order: number;
  default_necessity: string;
}

/**
 * Every category's colour, as `light-dark(<light>, <dark>)`, by id. A
 * category in a group without a slot (a ninth spending group, income,
 * transfers) gets none and is drawn in ink.
 */
export function categoryColors(
  categories: PaletteCategory[],
  groupSlots: Record<string, number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const order = (a: PaletteCategory, b: PaletteCategory) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  const topLevel = categories.filter((c) => c.parent_id === null).sort(order);

  for (const [group, slot] of Object.entries(groupSlots)) {
    const siblings = topLevel.filter((c) => c.group_name === group);
    const ladders = (['light', 'dark'] as const).map((theme) => {
      const from = base(slot, theme);
      const [lo, hi] = usable(from, theme);
      // Keep the deep end free for subcategories: below on light, above on dark.
      const [sLo, sHi] = theme === 'light' ? [lo + ROOM_FOR_OFFSHOOTS, hi] : [lo, hi - ROOM_FOR_OFFSHOOTS];
      return { theme, from, ls: spread(from.l, siblings.length, sLo, sHi, SIBLING_REACH, 'both') };
    });
    // The light theme decides who is lighter than whom; the dark theme keeps
    // that order, so the lighter of two oranges is the lighter in both.
    const rank = ladders[0].ls.map((l) => [...ladders[0].ls].sort((a, b) => a - b).indexOf(l));
    const darkSorted = [...ladders[1].ls].sort((a, b) => a - b);
    ladders[1].ls = rank.map((r) => darkSorted[r]);
    const parents = ladders.map(({ theme, from, ls }) => ({
      theme,
      shades: ls.map((l, i) => fit({ l, c: from.c, h: turned(from.h, TURNS[i % TURNS.length]) }, theme)),
    }));
    siblings.forEach((cat, i) => {
      const [light, dark] = parents.map((p) => p.shades[i]);
      out[cat.id] = lightDark(light, dark);

      const children = categories.filter((c) => c.parent_id === cat.id).sort(order);
      if (children.length === 0) return;
      const offshoots = parents.map(({ theme, shades }) => {
        const parent = shades[i];
        const [lo, hi] = usable(parent, theme);
        // Deeper is darker on the light theme and lighter on the dark one.
        const side = theme === 'light' ? 'below' : 'above';
        const anchor = parent.l + (theme === 'light' ? -1 : 1) * DEEPER;
        const ls = spread(anchor, children.length, lo, hi, CHILD_REACH, side);
        return ls.map((l, j) => fit({ l, c: parent.c, h: turned(parent.h, TURNS[(j + 1) % TURNS.length] / 2) }, theme));
      });
      children.forEach((child, j) => { out[child.id] = lightDark(offshoots[0][j], offshoots[1][j]); });
    });
  }
  return out;
}

/**
 * The lightness band a hue can use in a theme: inside the band the theme
 * allows, and at least SHADE_CONTRAST against every surface it sits on.
 */
function usable(from: Lch, theme: Theme): [number, number] {
  const [bandLo, bandHi] = theme === 'light' ? [0.34, 0.78] : [0.48, 0.8];
  const ok = (l: number) => SURFACES[theme].every((s) => contrast(toHex({ ...from, l }), s) >= SHADE_CONTRAST);
  let lo = bandLo;
  let hi = bandHi;
  while (hi > lo && !ok(hi)) hi -= 0.005;
  while (lo < hi && !ok(lo)) lo += 0.005;
  return [lo, hi];
}

/**
 * `n` lightnesses, evenly spaced around `center` within [lo, hi]: the first
 * nearest the centre, the rest alternating outward. `side` keeps them all on
 * one side of the centre (a subcategory's deeper side) or lets them spread.
 */
function spread(center: number, n: number, lo: number, hi: number, reach: number, side: 'both' | 'above' | 'below'): number[] {
  if (n <= 0) return [];
  const c = Math.min(hi, Math.max(lo, center));
  const need = Math.max(reach * (side === 'both' ? 2 : 1), (n - 1) * MIN_STEP);
  let a: number;
  let b: number;
  if (side === 'both') {
    // Slide the band back inside what the theme allows, then trim if it is
    // simply wider than the room there is.
    a = c - need / 2;
    b = a + need;
    if (b > hi) { a -= b - hi; b = hi; }
    if (a < lo) { b += lo - a; a = lo; }
    b = Math.min(b, hi);
  } else {
    // One side only, and never past the centre: a crowded family packs
    // closer together rather than crossing to the other side of its parent.
    [a, b] = side === 'above' ? [c, Math.min(hi, c + need)] : [Math.max(lo, c - need), c];
  }
  if (n === 1) return [c];
  const step = (b - a) / (n - 1);
  const ladder = Array.from({ length: n }, (_, k) => a + k * step);
  // Nearest the centre first, then alternately above and below it.
  const start = ladder.reduce((best, l, k) => (Math.abs(l - c) < Math.abs(ladder[best] - c) ? k : best), 0);
  const out: number[] = [ladder[start]];
  for (let d = 1; out.length < n; d++) {
    if (start + d < n) out.push(ladder[start + d]);
    if (out.length < n && start - d >= 0) out.push(ladder[start - d]);
  }
  return out;
}

/** The colour of a group slot, as `light-dark()`, for legends. */
export function groupColor(slot: number | null | undefined): string {
  if (!slot) return 'var(--color-chart-strong)';
  return `var(--color-group-${slot})`;
}

function base(slot: number, theme: Theme): Lch {
  const hex = (tokens[theme].color as Record<string, { $value: string }>)[`group-${slot}`]?.$value;
  if (!hex) throw new Error(`No group-${slot} in tokens.json`);
  return toLch(hex);
}

/** The hue turned by `by` degrees in whichever direction (or none) stays clearest of the reserved hues. */
function turned(h: number, by: number): number {
  const clearance = (x: number) => Math.min(...RESERVED_HUES.map(([r, berth]) =>
    Math.abs(((x - r + 540) % 360) - 180) / berth));
  // No turn first, so a tie keeps the family's own hue.
  const options = [h, h + by, h - by].map((x) => (x + 360) % 360);
  return options.reduce((best, x) => (clearance(x) > clearance(best) + 1e-9 ? x : best));
}

/** Into sRGB, and visible as a mark on the theme's surfaces. */
function fit(x: Lch, theme: Theme): Lch {
  const [lo, hi] = theme === 'light' ? [0.36, 0.76] : [0.5, 0.79];
  let l = Math.min(hi, Math.max(lo, x.l));
  for (let step = 0; step < 60; step++) {
    const hex = toHex({ ...x, l });
    if (SURFACES[theme].every((s) => contrast(hex, s) >= SHADE_CONTRAST)) break;
    l += theme === 'light' ? -0.01 : 0.01;
  }
  return { ...x, l };
}

function lightDark(light: Lch, dark: Lch): string {
  return `light-dark(${toHex(light)}, ${toHex(dark)})`;
}

// --- OKLCH <-> sRGB (Björn Ottosson's OKLab) --------------------------------

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toLch(hex: string): Lch {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function linearRgb({ l: L, c, h }: Lch): number[] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** To hex, reducing chroma until the colour exists in sRGB. */
export function toHex(x: Lch): string {
  let c = x.c;
  let rgb = linearRgb({ ...x, c });
  while (c > 0 && rgb.some((v) => v < -1e-4 || v > 1 + 1e-4)) {
    c -= 0.002;
    rgb = linearRgb({ ...x, c });
  }
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Exposed for tests: a colour's OKLCH, from hex. */
export const oklchOf = toLch;
