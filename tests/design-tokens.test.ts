/**
 * Keeps the design tokens Figma sees and the CSS the app ships from drifting,
 * and keeps both themes legible.
 *
 * src/app/globals.css is the single source of truth. docs/design/tokens.json
 * is derived from it by `npm run tokens` (scripts/tokens.ts), in the format
 * Tokens Studio reads, and Tokens Studio turns it into Figma variables. When
 * the two disagree, a mockup stops predicting the app — which is the entire
 * reason the design system exists.
 *
 * If the first test fails: you changed globals.css. Run `npm run tokens` and
 * commit the result, then pull it into Figma. Never edit tokens.json by hand;
 * the next run overwrites it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTokens, renderTokens, SETS, TOKENS_PATH, type TokenFile } from '../scripts/tokens';

const committed = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as TokenFile;
const css = readFileSync('src/app/globals.css', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');

describe('docs/design/tokens.json is globals.css, for Figma', () => {
  it('is exactly what npm run tokens writes from the current CSS', () => {
    const fresh = JSON.parse(renderTokens()) as TokenFile;
    const drift: string[] = [];
    const groups = [
      ['light', 'color'], ['light', 'font'], ['dark', 'color'],
    ] as const;
    for (const [set, group] of groups) {
      const a = (committed[set] as Record<string, Record<string, { $value: string }>>)[group];
      const b = (fresh[set] as Record<string, Record<string, { $value: string }>>)[group];
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const was = a[name]?.$value;
        const now = b[name]?.$value;
        if (was !== now) drift.push(`${set}/${group}/${name}: tokens.json ${was ?? '(missing)'} vs globals.css ${now ?? '(removed)'}`);
      }
    }
    expect(drift, `tokens.json is stale — run npm run tokens:\n  ${drift.join('\n  ')}`).toEqual([]);
    // Descriptions and layout too, not only values.
    expect(readFileSync(TOKENS_PATH, 'utf8')).toBe(renderTokens());
  });

  it('carries every @theme custom property', () => {
    // Counted without the generator's parser: comments stripped, then every
    // declaration anywhere in the block, including one sharing a comment's line.
    const theme = /@theme(?:\s+static)?\s*\{([\s\S]*?)\n\}/.exec(css)![1].replace(/\/\*[\s\S]*?\*\//g, '');
    const declared = [...theme.matchAll(/(--(?:color|font)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const tokens = [
      ...Object.keys(committed.light.color).map((n) => `--color-${n}`),
      ...Object.keys(committed.light.font).map((n) => `--font-${n}`),
    ];
    expect(tokens.sort()).toEqual([...new Set(declared)].sort());
  });

  it('chooses a dark value for every colour, not just a light one', () => {
    // A colour with no dark half would show its light value on a dark ground.
    expect(Object.keys(committed.dark.color).sort()).toEqual(Object.keys(committed.light.color).sort());
  });

  it('is a file Tokens Studio can load', () => {
    // A token set per top-level key, plus the two $-keys beside them; any
    // other top-level key would be read as a set.
    expect(Object.keys(committed).sort()).toEqual(['$metadata', '$themes', ...SETS].sort());
    expect(committed.$metadata.tokenSetOrder).toEqual([...SETS]);
    // The Dark theme reads light as its source, so the fonts reach it too.
    expect(committed.$themes.map((t) => [t.name, t.selectedTokenSets])).toEqual([
      ['Light', { light: 'enabled' }],
      ['Dark', { light: 'source', dark: 'enabled' }],
    ]);
    for (const set of SETS) {
      for (const group of Object.values(committed[set])) {
        for (const [name, token] of Object.entries(group)) {
          expect(Object.keys(token).every((k) => ['$value', '$type', '$description'].includes(k)), name).toBe(true);
          // Tokens Studio rejects these characters in token names.
          expect(/[{}$]/.test(name), name).toBe(false);
          if (token.$type === 'color') expect(token.$value, name).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('takes the font family names from the fonts the app loads', () => {
    expect(committed.light.font.sans.$value).toBe('Inter Tight');
    expect(committed.light.font.mono.$value).toBe('JetBrains Mono');
  });

  it('takes the meaning along with the colour', () => {
    // Figma shows a variable's description; the amber rule has to travel.
    expect(committed.light.color.edited.$description).toMatch(/Reserved for human edits/);
    expect(committed.dark.color.edited.$description).toMatch(/Reserved for human edits/);
  });

  it('reads a declaration that shares a line with a comment', () => {
    const theme = (body: string) => `@theme {\n${body}\n}\n`;
    const t = buildTokens(theme([
      '  /* before */ --color-a: #111111;',
      '  --color-b: #222222; /* after b */',
      '  --color-c: #333333;',
    ].join('\n')), layout).light.color;
    expect(Object.keys(t)).toEqual(['a', 'b', 'c']);
    expect(t.a.$description).toBe('before');
    // "after b" describes b, and "before" still reaches c — no blank line between.
    expect(t.b.$description).toBe('before after b');
    expect(t.c.$description).toBe('before');
  });

  it('splits light-dark() into the two sets', () => {
    const t = buildTokens('@theme static {\n  --color-a: light-dark(#ABCDEF, #123456);\n}\n', layout);
    expect(t.light.color.a.$value).toBe('#abcdef');
    expect(t.dark.color.a.$value).toBe('#123456');
  });

  it('reads Windows line endings the same as Unix ones', () => {
    const lf = '@theme {\n  /* first */\n  --color-a: #111111;\n\n  --color-b: #222222;\n}\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(buildTokens(crlf, layout)).toEqual(buildTokens(lf, layout));
    // The blank line ends the comment's reach: b has no description.
    expect(buildTokens(crlf, layout).light.color.b.$description).toBeUndefined();
  });

  it('refuses what it cannot translate rather than guessing', () => {
    const theme = (body: string) => `@theme {\n${body}\n}\n`;
    expect(() => buildTokens(theme('  --color-x: oklch(70% 0.1 200);'), layout)).toThrow(/not a #rrggbb/);
    expect(() => buildTokens(theme('  --color-x: light-dark(#111111, red);'), layout)).toThrow(/not a #rrggbb/);
    expect(() => buildTokens(theme('  --font-x: var(--font-unknown), serif;'), layout)).toThrow(/cannot resolve/);
    expect(() => buildTokens(theme('  --radius-x: 4px;'), layout)).toThrow(/no token type/);
    expect(() => buildTokens(theme('  --color-x #123456;'), layout)).toThrow(/Unreadable/);
  });
});

// ---------------------------------------------------------------------------
// Colour arithmetic, re-derived here rather than trusted from the audit, so a
// future colour change cannot quietly reintroduce an accessibility failure.
// WCAG 2 contrast; OKLab (Björn Ottosson) for perceptual distance, ×100; and
// the Machado–Oliveira–Fernandes 2009 simulation at severity 1.0, which is
// what the dataviz validator's thresholds are calibrated against.
// ---------------------------------------------------------------------------

const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = parse(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function oklab([r, g, b]: number[]): number[] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
const simulate = (rgb: number[], m: number[][]) =>
  m.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
/** OKLab distance ×100, as seen with normal vision or under a simulation. */
function deltaE(a: string, b: string, vision?: keyof typeof MACHADO): number {
  const la = parse(a).map(linear);
  const lb = parse(b).map(linear);
  const [A, B] = vision ? [oklab(simulate(la, MACHADO[vision])), oklab(simulate(lb, MACHADO[vision]))] : [oklab(la), oklab(lb)];
  return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
const cvd = (a: string, b: string) => Math.min(deltaE(a, b, 'protan'), deltaE(a, b, 'deutan'));

const THEMES = SETS.map((set) => ({
  set,
  P: Object.fromEntries(Object.entries(committed[set].color).map(([name, t]) => [name, t.$value])),
}));

describe.each(THEMES)('the $set theme', ({ P }) => {
  const GROUPS = Object.keys(P).filter((k) => /^group-\d+$/.test(k))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));

  it('keeps every text ink above 4.5:1 on every surface it sits on', () => {
    // These carry content at 11-16px, below the large-text threshold.
    for (const ink of ['ink', 'ink-dim', 'ink-faint']) {
      for (const ground of ['ground', 'raised', 'well', 'card']) {
        const r = contrast(P[ink], P[ground]);
        expect(r, `${ink} on ${ground} is ${r.toFixed(2)}:1, below AA 4.5:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the reserved colours legible as text', () => {
    // Amber means "a human changed this". If it is hard to see, the one signal
    // the ledger depends on stops working. Earned and alert are text too.
    for (const token of ['edited', 'earned', 'alert']) {
      for (const ground of ['ground', 'raised', 'card']) {
        const r = contrast(P[token], P[ground]);
        expect(r, `${token} on ${ground} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // A token pair can pass on its own and still fail on screen: CSS `opacity`
  // on an ancestor composites the whole subtree, so a badge's background and
  // its text fade together and the ratio between them collapses. The pending
  // row used to carry `opacity-60` on the <tr>, which took the "pending" badge
  // below AA — the one label on that row you need to read. It now dims its own
  // text instead. This asserts the badge as drawn, on its well.
  it('keeps the pending badge legible', () => {
    const r = contrast(P['ink-faint'], P['well']);
    expect(r, `the pending badge is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  // Two touching neutral bands — the Flow's buckets, fixed under variable —
  // are told apart only by lightness, which WCAG 1.4.11 puts at 3:1.
  it('separates the two chart inks from each other and from the ground', () => {
    const pair = contrast(P['chart-strong'], P['chart-mid']);
    expect(pair, `chart-strong and chart-mid are ${pair.toFixed(2)}:1 apart`).toBeGreaterThanOrEqual(3);
    for (const t of ['chart-strong', 'chart-mid']) {
      for (const surface of ['ground', 'card']) {
        const r = contrast(P[t], P[surface]);
        expect(r, `${t} on the ${surface} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('has the eight group slots, each a mark visible on the ground', () => {
    expect(GROUPS).toEqual(['group-1', 'group-2', 'group-3', 'group-4', 'group-5', 'group-6', 'group-7', 'group-8']);
    for (const g of GROUPS) {
      for (const surface of ['ground', 'card']) {
        const r = contrast(P[g], P[surface]);
        expect(r, `${g} on the ${surface} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // V9. Within a bucket the Flow orders categories by group, so neighbouring
  // colours are neighbouring slots — the pairs the dataviz validator checks.
  it('separates neighbouring group slots for every reader', () => {
    for (let i = 0; i + 1 < GROUPS.length; i++) {
      const [a, b] = [P[GROUPS[i]], P[GROUPS[i + 1]]];
      const n = deltaE(a, b);
      const c = cvd(a, b);
      expect(n, `${GROUPS[i]} and ${GROUPS[i + 1]}: normal-vision ΔE ${n.toFixed(1)}`).toBeGreaterThanOrEqual(15);
      expect(c, `${GROUPS[i]} and ${GROUPS[i + 1]}: colour-blind ΔE ${c.toFixed(1)}`).toBeGreaterThanOrEqual(8);
    }
  });

  // A month with no spending in one group puts the groups either side of it
  // next to each other. The six slots in use hold up to that too.
  it('separates slots one apart, for a month missing a group', () => {
    for (let i = 0; i + 2 < 6; i++) {
      const [a, b] = [P[GROUPS[i]], P[GROUPS[i + 2]]];
      expect(deltaE(a, b), `${GROUPS[i]} and ${GROUPS[i + 2]}`).toBeGreaterThanOrEqual(15);
      expect(cvd(a, b), `${GROUPS[i]} and ${GROUPS[i + 2]}`).toBeGreaterThanOrEqual(8);
    }
  });
});
