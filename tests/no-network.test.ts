/**
 * Nothing about a transaction leaves this machine except the SimpleFIN pull.
 *
 * Categorisation used to send merchant names to a language model. That step
 * was retired (DESIGN.md §8), and this file keeps it retired: a dependency, an
 * API host, or a stray fetch() is how it would come back, and none of those
 * fail anything on their own — the ledger would just quietly start sending
 * descriptions of your spending to someone else.
 *
 * Static checks over the tracked source, in the same spirit as
 * architecture.test.ts: they assert facts about the code, not that it ran.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every .ts/.tsx/.mjs file under the given roots. */
function sourceFiles(...roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
    }
  };
  for (const r of roots) walk(r);
  return out;
}

const CODE = sourceFiles('src', 'scripts');

/** Package names, or scope prefixes ending in '/', that exist to call a model. */
const LLM_PACKAGES = [
  '@anthropic-ai/', 'openai', '@google/generative-ai', '@google/genai',
  'ai', '@ai-sdk/', 'langchain', '@langchain/', 'cohere-ai', '@mistralai/',
  'ollama', 'groq-sdk', 'replicate', '@huggingface/', 'llamaindex',
];

const isLlmPackage = (name: string) =>
  LLM_PACKAGES.some((p) => (p.endsWith('/') ? name.startsWith(p) : name === p));

describe('no language-model client is installed', () => {
  it('declares no LLM SDK in package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    expect(names.filter(isLlmPackage)).toEqual([]);
  });

  it('resolves no LLM SDK anywhere in the lockfile, transitive included', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, unknown>;
    };
    const installed = Object.keys(lock.packages)
      .map((k) => k.replace(/^.*node_modules\//, ''))
      .filter(Boolean);
    expect(installed.filter(isLlmPackage)).toEqual([]);
  });
});

describe('no code can reach a model', () => {
  it('names no LLM API host', () => {
    const HOSTS = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(com|ai)|api\.groq\.com|openrouter\.ai|:11434\b/i;
    const hits = CODE.filter((f) => HOSTS.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('makes no outbound request except the SimpleFIN client', () => {
    // Browser code calls this app's own routes, always as a relative /api/
    // path. The one place allowed to reach another host is the bridge client.
    const ALLOWED = new Set([join('src', 'ingest', 'simplefin.ts')]);
    const offenders: string[] = [];

    for (const f of CODE) {
      if (ALLOWED.has(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\bfetch\(\s*([^,)\n]*)/g)) {
        const target = m[1].trim();
        if (!/^[`'"]\/api\//.test(target)) offenders.push(`${f}: fetch(${target}`);
      }
      // Any other HTTP client would bypass the fetch check above.
      if (/from ['"](node:)?(https?|net|tls|http2)['"]|from ['"](axios|undici|got|node-fetch|ky)['"]/.test(text)) {
        offenders.push(`${f}: imports a network client`);
      }
    }

    expect(offenders, `unexpected network access:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('keeps categorisation local: src/categorize touches no network at all', () => {
    const files = sourceFiles(join('src', 'categorize'));
    expect(files.length).toBeGreaterThan(0);
    const networked = files.filter((f) => /\bfetch\(|process\.env/.test(readFileSync(f, 'utf8')));
    expect(networked).toEqual([]);
  });

  it('has no model-assigned category source in the schema', () => {
    const schema = readFileSync('db/schema.sql', 'utf8');
    const block = /CREATE TYPE category_source AS ENUM \(([\s\S]*?)\);/.exec(schema);
    expect(block).not.toBeNull();
    const values = [...block![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(values).toEqual([
      'unset', 'default', 'import', 'rule', 'history', 'income_source', 'manual',
    ]);
  });
});
