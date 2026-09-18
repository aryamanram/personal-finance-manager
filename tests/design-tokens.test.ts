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

  it('keeps the flow colours distinguishable from the ground', () => {
    for (const token of ['green/base', 'clay/base', 'blue/base']) {
      const r = contrast(P[token], P['ink/900']);
      expect(r, `${token} on ink/900 is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });
});
