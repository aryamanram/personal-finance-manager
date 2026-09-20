/**
 * Keeps the Figma design system and the app's CSS from drifting apart.
 *
 * The Figma file at docs/design/figma-tokens.json is the design source of
 * truth; src/app/globals.css is what actually ships. When they disagree, a
 * mockup stops predicting the app — which is the entire reason the design
 * system exists.
 *
 * This is the free half of what Figma's Code Connect would do. Code Connect
 * needs an Organization plan; a test that fails the build is arguably stronger,
 * because drift breaks CI rather than just looking stale in a panel.
 *
 * If this test fails: change BOTH the Figma variable and globals.css, then
 * update the snapshot. Never silence it by editing only the snapshot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

interface Snapshot {
  primitives: Record<string, string>;
  cssVariableFor: Record<string, string>;
}

const snapshot = JSON.parse(
  readFileSync('docs/design/figma-tokens.json', 'utf8'),
) as Snapshot;
const css = readFileSync('src/app/globals.css', 'utf8');

/** Read a custom property's value out of the @theme block. */
function cssValue(name: string): string | null {
  const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(css);
  return m ? m[1].toLowerCase() : null;
}

describe('Figma and globals.css agree on every colour token', () => {
  it('maps every Figma primitive to a CSS variable', () => {
    const missing = Object.keys(snapshot.primitives)
      .filter((k) => !(k in snapshot.cssVariableFor));
    expect(missing, `Figma primitives with no CSS mapping: ${missing.join(', ')}`).toEqual([]);
  });

  it('has the same value on both sides', () => {
    const drift: string[] = [];

    for (const [token, figmaHex] of Object.entries(snapshot.primitives)) {
      const cssVar = snapshot.cssVariableFor[token];
      const actual = cssValue(cssVar);

      if (actual === null) {
        drift.push(`${cssVar} is not defined in globals.css (Figma has ${token} = ${figmaHex})`);
        continue;
      }
      if (actual !== figmaHex.toLowerCase()) {
        drift.push(`${token}: Figma ${figmaHex} vs ${cssVar} ${actual}`);
      }
    }

    expect(drift, `design tokens have drifted:\n  ${drift.join('\n  ')}`).toEqual([]);
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

  const P = snapshot.primitives;

  it('keeps body text above 4.5:1 on the page ground', () => {
    // These carry actual content at 11-16px, below the large-text threshold.
    for (const token of ['paper/base', 'paper/dim', 'paper/faint']) {
      const r = contrast(P[token], P['ink/900']);
      expect(r, `${token} on ink/900 is ${r.toFixed(2)}:1, below AA 4.5:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the edited marker clearly legible', () => {
    // Amber means "a human changed this". If it is hard to see, the one signal
    // the ledger depends on stops working.
    const r = contrast(P['amber/base'], P['ink/900']);
    expect(r, `amber on ink/900 is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
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
      const bg = composite(P['ink/700'], P['ink/900'], alpha);
      const fg = composite(P['paper/faint'], P['ink/900'], alpha);
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
    const r = contrast(P['clay/base'], P['clay/lift']);
    expect(
      r,
      `the fixed band ${P['clay/base']} and the variable band ${P['clay/lift']} are ` +
        `${r.toFixed(2)}:1 apart, below the 3:1 WCAG asks of meaningful graphics`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('keeps the flow colours distinguishable from the ground', () => {
    for (const token of ['green/base', 'clay/base', 'blue/base']) {
      const r = contrast(P[token], P['ink/900']);
      expect(r, `${token} on ink/900 is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  // The palette is entirely cool, so inflow and outflow are close in hue by
  // design. That makes LIGHTNESS the only thing keeping them apart, and a
  // well-meaning tweak toward "prettier" could silently merge the two colours
  // that a ledger must never confuse. Pin the gap.
  it('separates inflow from outflow by lightness, not hue alone', () => {
    const r = contrast(P['green/base'], P['clay/base']);
    expect(
      r,
      `inflow ${P['green/base']} vs outflow ${P['clay/base']} is only ${r.toFixed(2)}:1. ` +
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
    const BUCKETS = ['flow/required', 'flow/discretionary', 'flow/invest', 'flow/leftover'];

    for (const token of BUCKETS) {
      const r = contrast(P[token], P['ink/900']);
      expect(r, `${token} on ink/900 is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
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
      const r = contrast(simulate(P['green/base'], matrix), simulate(P['clay/base'], matrix));
      expect(r, `under ${name} inflow and outflow are ${r.toFixed(2)}:1 apart`)
        .toBeGreaterThanOrEqual(2.5);
    }
  });
});
