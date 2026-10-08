/**
 * Keeps the design tokens Figma sees and the CSS the app ships from drifting.
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
import { buildTokens, renderTokens, SET, TOKENS_PATH, type TokenFile } from '../scripts/tokens';

const committed = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as TokenFile;
const css = readFileSync('src/app/globals.css', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');

describe('docs/design/tokens.json is globals.css, for Figma', () => {
  it('is exactly what npm run tokens writes from the current CSS', () => {
    const fresh = JSON.parse(renderTokens()) as TokenFile;
    const drift: string[] = [];
    for (const group of ['color', 'font'] as const) {
      const a = committed[SET][group];
      const b = fresh[SET][group];
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const was = a[name]?.$value;
        const now = b[name]?.$value;
        if (was !== now) drift.push(`${group}/${name}: tokens.json ${was ?? '(missing)'} vs globals.css ${now ?? '(removed)'}`);
      }
    }
    expect(drift, `tokens.json is stale — run npm run tokens:\n  ${drift.join('\n  ')}`).toEqual([]);
    // Descriptions and layout too, not only values.
    expect(readFileSync(TOKENS_PATH, 'utf8')).toBe(renderTokens());
  });

  it('carries every @theme custom property', () => {
    // Counted without the generator's parser: comments stripped, then every
    // declaration anywhere in the block, including one sharing a comment's line.
    const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)![1].replace(/\/\*[\s\S]*?\*\//g, '');
    const declared = [...theme.matchAll(/(--(?:color|font)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const tokens = [
      ...Object.keys(committed[SET].color).map((n) => `--color-${n}`),
      ...Object.keys(committed[SET].font).map((n) => `--font-${n}`),
    ];
    expect(tokens.sort()).toEqual([...new Set(declared)].sort());
  });

  it('is a file Tokens Studio can load', () => {
    // A token set per top-level key, plus the two $-keys beside them; any
    // other top-level key would be read as a set.
    expect(Object.keys(committed).sort()).toEqual(['$metadata', '$themes', SET].sort());
    expect(committed.$metadata.tokenSetOrder).toEqual([SET]);
    for (const group of Object.values(committed[SET])) {
      for (const [name, token] of Object.entries(group)) {
        expect(Object.keys(token).every((k) => ['$value', '$type', '$description'].includes(k)), name).toBe(true);
        // Tokens Studio rejects these characters in token names.
        expect(/[{}$]/.test(name), name).toBe(false);
        if (token.$type === 'color') expect(token.$value, name).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('takes the font family names from the fonts the app loads', () => {
    expect(committed[SET].font.sans.$value).toBe('Inter Tight');
    expect(committed[SET].font.mono.$value).toBe('JetBrains Mono');
  });

  it('takes the meaning along with the colour', () => {
    // Figma shows a variable's description; the amber rule has to travel.
    expect(committed[SET].color.edited.$description).toMatch(/Reserved for human edits/);
  });

  it('reads a declaration that shares a line with a comment', () => {
    const theme = (body: string) => `@theme {\n${body}\n}\n`;
    const t = buildTokens(theme([
      '  /* before */ --color-a: #111111;',
      '  --color-b: #222222; /* after b */',
      '  --color-c: #333333;',
    ].join('\n')), layout).ledger.color;
    expect(Object.keys(t)).toEqual(['a', 'b', 'c']);
    expect(t.a.$description).toBe('before');
    // "after b" describes b, and "before" still reaches c — no blank line between.
    expect(t.b.$description).toBe('before after b');
    expect(t.c.$description).toBe('before');
  });

  it('refuses what it cannot translate rather than guessing', () => {
    const theme = (body: string) => `@theme {\n${body}\n}\n`;
    expect(() => buildTokens(theme('  --color-x: oklch(70% 0.1 200);'), layout)).toThrow(/not a #rrggbb/);
    expect(() => buildTokens(theme('  --font-x: var(--font-unknown), serif;'), layout)).toThrow(/cannot resolve/);
    expect(() => buildTokens(theme('  --radius-x: 4px;'), layout)).toThrow(/no token type/);
    expect(() => buildTokens(theme('  --color-x #123456;'), layout)).toThrow(/Unreadable/);
  });
});

describe('contrast stays within WCAG AA', () => {
  // Re-derived here rather than trusted from the audit, so a future colour
  // change cannot quietly reintroduce an accessibility failure.
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const parse = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  });
  const luminance = (hex: string) => {
    const { r, g, b } = parse(hex);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const P = Object.fromEntries(
    Object.entries(committed[SET].color).map(([name, t]) => [name, t.$value]),
  );

  it('keeps body text above 4.5:1 on the page ground', () => {
    // These carry actual content at 11-16px, below the large-text threshold.
    for (const token of ['paper', 'paper-dim', 'paper-faint']) {
      const r = contrast(P[token], P['ink-900']);
      expect(r, `${token} on ink-900 is ${r.toFixed(2)}:1, below AA 4.5:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the edited marker clearly legible', () => {
    // Amber means "a human changed this". If it is hard to see, the one signal
    // the ledger depends on stops working.
    const r = contrast(P['edited'], P['ink-900']);
    expect(r, `edited (amber) on ink-900 is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  // A token pair can pass on its own and still fail on screen: CSS `opacity`
  // on an ancestor composites the whole subtree, so a badge's background and
  // its text fade together and the ratio between them collapses. The pending
  // row used to carry `opacity-60` on the <tr>, which took the "pending" badge
  // to 2.46:1 — the one label on that row you need to read. It now dims its own
  // text instead. This asserts the badge survives whatever dimming is applied.
  it('keeps the pending badge legible however the row is dimmed', () => {
    const composite = (fg: string, bg: string, alpha: number) => {
      const f = parse(fg);
      const b = parse(bg);
      const mix = (x: number, y: number) => Math.round((x * alpha + y * (1 - alpha)) * 255);
      return `#${[mix(f.r, b.r), mix(f.g, b.g), mix(f.b, b.b)]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')}`;
    };

    // 1 = today's behaviour (text-only dim, badge untouched). The lower values
    // stand in for anyone reintroducing a subtree opacity.
    for (const alpha of [1, 0.6]) {
      const bg = composite(P['ink-700'], P['ink-900'], alpha);
      const fg = composite(P['paper-faint'], P['ink-900'], alpha);
      const r = contrast(fg, bg);

      if (alpha === 1) {
        expect(r, `the undimmed pending badge is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      } else {
        // Documents why the subtree opacity had to go, and fails loudly if a
        // future change makes it survivable-looking without actually fixing it.
        expect(
          r,
          `compositing the badge at ${alpha} gives ${r.toFixed(2)}:1. If this now ` +
            'passes, the palette changed — re-check whether dimming the row subtree ' +
            'is safe again before reintroducing it.',
        ).toBeLessThan(4.5);
      }
    }
  });

  // The cost-mix chart stacks fixed under variable as two touching bands whose
  // colours are the only thing identifying them, which WCAG 1.4.11 puts at
  // 3:1 against each other. Unlike the Sankey's four buckets (below), two
  // bands can reach that comfortably, so they are held to the full bar.
  it('separates the cost-mix chart bands by 3:1', () => {
    const r = contrast(P['out'], P['out-lift']);
    expect(
      r,
      `the fixed band ${P['out']} and the variable band ${P['out-lift']} are ` +
        `${r.toFixed(2)}:1 apart, below the 3:1 WCAG asks of meaningful graphics`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('keeps the flow colours distinguishable from the ground', () => {
    for (const token of ['in', 'out', 'invest']) {
      const r = contrast(P[token], P['ink-900']);
      expect(r, `${token} on ink-900 is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  // The palette is entirely cool, so inflow and outflow are close in hue by
  // design. That makes LIGHTNESS the only thing keeping them apart, and a
  // well-meaning tweak toward "prettier" could silently merge the two colours
  // that a ledger must never confuse. Pin the gap.
  it('separates inflow from outflow by lightness, not hue alone', () => {
    const r = contrast(P['in'], P['out']);
    expect(
      r,
      `inflow ${P['in']} vs outflow ${P['out']} is only ${r.toFixed(2)}:1. ` +
        'They must differ in lightness by at least 3:1 so the distinction survives ' +
        'red-green colourblindness.',
    ).toBeGreaterThanOrEqual(3);
  });

  // `Sankey.tsx` filters out zero-valued buckets before layout, so ANY pair can
  // end up touching depending on the month's data — a month with nothing
  // discretionary puts Required directly against Invested. The earlier version
  // of this test only checked the full four-bucket order, which is the best
  // case rather than the guaranteed one.
  //
  // Four cool colours cannot separate all six pairs by lightness and keep the
  // hue spread colourblind viewers depend on. The ceiling is 1.86:1 — four
  // luminances in geometric progression, each clearing 3:1 against the ground,
  // with the lightest forced to pure white. Chasing it flattens the palette to
  // near-identical hues and drops the worst deuteranopia pair to 1.08:1, which
  // is worse than what it replaces.
  //
  // So the guarantee does not come from colour: every ribbon is drawn over a
  // ground-coloured stroke 1.5px wider than itself, parting touching ribbons
  // with a visible seam, and every bucket carries a text label. Colour is a
  // secondary cue (WCAG 1.4.1), which is what makes the remaining overlap
  // acceptable. These assertions keep it honest as a secondary cue.
  it('keeps every reachable bucket pair distinguishable', () => {
    const BUCKETS = ['flow-required', 'flow-discretionary', 'flow-invest', 'flow-leftover'];

    for (const token of BUCKETS) {
      const r = contrast(P[token], P['ink-900']);
      expect(r, `${token} on ink-900 is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }

    // Every pair, since any of them can become adjacent.
    const hue = (hex: string) => {
      const { r, g, b } = parse(hex);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };

    for (let i = 0; i < BUCKETS.length; i++) {
      for (let j = i + 1; j < BUCKETS.length; j++) {
        const [a, b] = [BUCKETS[i], BUCKETS[j]];
        const ratio = contrast(P[a], P[b]);
        let deg = Math.abs(hue(P[a]) - hue(P[b]));
        if (deg > 180) deg = 360 - deg;

        // A pair may be told apart by lightness OR by hue. Requiring both is
        // what the maths above shows to be impossible for four cool colours.
        expect(
          ratio >= 1.8 || deg >= 30,
          `${a} and ${b} can end up adjacent but differ by only ${ratio.toFixed(2)}:1 ` +
            `and ${Math.round(deg)}deg — they need one of lightness (1.8:1) or hue (30deg)`,
        ).toBe(true);
      }
    }
  });

  it('keeps inflow and outflow apart under red-green colourblindness', () => {
    // Brettel-style linear approximations. Not a substitute for real testing,
    // but enough to catch a palette change that collapses the two.
    const toLinear = (c: number) => channel(c);
    const toSrgb = (c: number) => {
      const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, v)) * 255);
    };
    const simulate = (hex: string, m: number[]) => {
      const { r, g, b } = parse(hex);
      const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
      const out = [
        m[0] * R + m[1] * G + m[2] * B,
        m[3] * R + m[4] * G + m[5] * B,
        m[6] * R + m[7] * G + m[8] * B,
      ];
      return `#${out.map(toSrgb).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };

    const FORMS = {
      deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
      protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
    };

    for (const [name, matrix] of Object.entries(FORMS)) {
      const r = contrast(simulate(P['in'], matrix), simulate(P['out'], matrix));
      expect(r, `under ${name} inflow and outflow are ${r.toFixed(2)}:1 apart`)
        .toBeGreaterThanOrEqual(2.5);
    }
  });
});
