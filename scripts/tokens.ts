/**
 * Writes docs/design/tokens.json from src/app/globals.css.
 *
 *   npm run tokens
 *
 * globals.css is the single source of truth for the design tokens; this file
 * is derived from it, for Tokens Studio to bring into Figma as variables. It
 * is never edited by hand — tests/design-tokens.test.ts fails if it differs
 * from what this script would write, and names the token that drifted.
 *
 * The format is Tokens Studio's: a token set per top-level key, `$themes` and
 * `$metadata` beside them, and tokens written with W3C DTCG's `$value`,
 * `$type`, `$description` — colours as hex strings, which Tokens Studio reads
 * and the 2025.10 DTCG colour objects are not. Set the plugin's token format
 * to "W3C DTCG".
 *
 * Two sets, one per theme. Every colour in globals.css is written
 * `light-dark(<light>, <dark>)`; the light half goes to the `light` set with
 * the fonts, the dark half to `dark`. The Dark theme reads `light` as its
 * source and `dark` over it, so a font (or anything not themed) has one home.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TOKENS_PATH = 'docs/design/tokens.json';
/** The two token sets; Figma variables come out as color/ground, font/sans. */
export const SETS = ['light', 'dark'] as const;

interface Token { $value: string; $type: 'color' | 'fontFamily'; $description?: string }
interface Theme {
  id: string;
  name: string;
  selectedTokenSets: Record<string, 'enabled' | 'source'>;
}
export type TokenFile = {
  light: { color: Record<string, Token>; font: Record<string, Token> };
  dark: { color: Record<string, Token> };
  $themes: Theme[];
  $metadata: { tokenSetOrder: string[] };
};

const THEMES: Theme[] = [
  { id: 'light', name: 'Light', selectedTokenSets: { light: 'enabled' } },
  { id: 'dark', name: 'Dark', selectedTokenSets: { light: 'source', dark: 'enabled' } },
];

/** next/font loaders in the root layout: `Inter_Tight({ … variable: '--font-inter-tight' })`. */
export function fontFamilies(layout: string): Map<string, string> {
  const families = new Map<string, string>();
  for (const m of layout.matchAll(/\b([A-Z][A-Za-z0-9_]*)\(\{[^}]*variable:\s*'(--font-[a-z0-9-]+)'/g)) {
    families.set(m[2], m[1].replace(/_/g, ' '));
  }
  return families;
}

/**
 * Every custom property in the @theme block, with the comment that explains
 * it. A comment describes the declarations after it, up to the next blank
 * line or comment — which is how globals.css is written — except one on the
 * same line AFTER a declaration, which describes that declaration.
 *
 * Read as a sequence of comments, declarations and blank lines rather than
 * line by line, so a declaration that shares a line with a comment is not
 * skipped. Anything else in the block stops the build.
 */
export function themeDeclarations(source: string): { name: string; value: string; description?: string }[] {
  // Windows line endings would hide every blank line from the scan below,
  // letting a comment describe declarations it was never meant to reach.
  const css = source.replace(/\r\n?/g, '\n');
  const block = /@theme(?:\s+static)?\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) throw new Error('globals.css has no @theme block');
  const body = block[1];

  const out: { name: string; value: string; description?: string }[] = [];
  let comment: string | undefined;
  let lastDeclarationEnd = -1;
  let at = 0;
  const unreadable = (text: string) => {
    if (text.trim() !== '') throw new Error(`Unreadable text in @theme: ${text.trim()}`);
  };

  for (const m of body.matchAll(/\/\*([\s\S]*?)\*\/|(--[a-z0-9-]+)\s*:\s*([^;]+);|\n[ \t]*\n/g)) {
    unreadable(body.slice(at, m.index));
    at = m.index + m[0].length;

    if (m[1] !== undefined) {
      const text = m[1].replace(/\s+/g, ' ').trim();
      const sameLine = lastDeclarationEnd >= 0 && !body.slice(lastDeclarationEnd, m.index).includes('\n');
      if (sameLine) {
        const d = out[out.length - 1];
        d.description = d.description ? `${d.description} ${text}` : text;
      } else {
        comment = text;
      }
    } else if (m[2] !== undefined) {
      out.push({ name: m[2], value: m[3].trim(), description: comment });
      lastDeclarationEnd = at;
    } else {
      comment = undefined; // a blank line ends a comment's reach
    }
  }
  unreadable(body.slice(at));
  return out;
}

const HEX = '#[0-9a-fA-F]{6}';
const THEMED = new RegExp(`^light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)$`);

export function buildTokens(css: string, layout: string): TokenFile {
  const families = fontFamilies(layout);
  const light: Record<string, Token> = {};
  const dark: Record<string, Token> = {};
  const font: Record<string, Token> = {};

  for (const { name, value, description } of themeDeclarations(css)) {
    const desc = description ? { $description: description } : {};
    if (name.startsWith('--color-')) {
      // light-dark() of two hexes, or one hex for a colour both themes share.
      // Anything else (oklch, a var()) is a decision about how Figma should
      // see it, so it stops the build rather than guessing.
      const key = name.slice('--color-'.length);
      const themed = THEMED.exec(value);
      if (themed) {
        light[key] = { $value: themed[1].toLowerCase(), $type: 'color', ...desc };
        dark[key] = { $value: themed[2].toLowerCase(), $type: 'color', ...desc };
      } else if (new RegExp(`^${HEX}$`).test(value)) {
        light[key] = { $value: value.toLowerCase(), $type: 'color', ...desc };
      } else {
        throw new Error(`${name}: ${value} is not a #rrggbb colour or light-dark() of two`);
      }
    } else if (name.startsWith('--font-')) {
      // `var(--font-inter-tight), ui-sans-serif, …` — Figma needs the family
      // name the app actually loads, which next/font defines in the layout.
      const ref = /^var\((--font-[a-z0-9-]+)\)/.exec(value);
      const family = ref && families.get(ref[1]);
      if (!family) throw new Error(`${name}: cannot resolve ${value} to a font family in app/layout.tsx`);
      font[name.slice('--font-'.length)] = { $value: family, $type: 'fontFamily', ...desc };
    } else {
      throw new Error(`${name}: no token type for this kind of custom property yet`);
    }
  }

  return {
    light: { color: light, font },
    dark: { color: dark },
    $themes: THEMES,
    $metadata: { tokenSetOrder: [...SETS] },
  };
}

export function renderTokens(): string {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const layout = readFileSync('src/app/layout.tsx', 'utf8');
  return `${JSON.stringify(buildTokens(css, layout), null, 2)}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  writeFileSync(TOKENS_PATH, renderTokens());
  console.log(`✓ wrote ${TOKENS_PATH} from src/app/globals.css`);
}
