// Asserts the case-study header cannot push a phone page sideways (#52): each H1 is
// sized from its own longest word, falls back to breaking a word rather than overflowing,
// and the prev/next nav columns can shrink below their titles' width.
// The 390px measurement itself was done in a browser (see the PR); these tests pin the
// rules that produce it. Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projects } from './lib/projects.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const visible = projects().filter((p) => p.visible);
const page = (slug) => readFileSync(`dist/work/${slug}/index.html`, 'utf8');
const longest = (title) => Math.max(...title.split(/\s+/).map((w) => w.length));

test('every case-study H1 carries its longest word length', () => {
  assert.ok(visible.length > 0);
  for (const p of visible) {
    const h1 = page(p.slug).match(/<h1 class="[^"]*\bcase-title\b[^"]*"[^>]*>/)?.[0];
    assert.ok(h1, `${p.slug}: case-title H1`);
    assert.match(h1, new RegExp(`--longest: ${longest(p.title)}\\b`), p.slug);
  }
});

test('the H1 shrinks to fit its longest word and breaks rather than overflow', () => {
  const html = page('skatedownhills');
  assert.match(html, /--longest: 14\b/);
  assert.match(html, /\.case-head\[[^\]]+\]\{container-type:inline-size\}/);
  const rule = html.match(/\.case-title\[[^\]]+\]\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /font-size:min\(var\(--text-4xl\), *100cqi \/ \(var\(--longest/);
  assert.match(rule, /overflow-wrap:anywhere/);
});

test('prev/next nav columns can shrink below a long title', () => {
  const html = page('jdm-parts-webshop');
  const nav = html.match(/\.case-nav\[[^\]]+\]\{([^}]*)\}/)?.[1] ?? '';
  assert.match(nav, /grid-template-columns:repeat\(2, *minmax\(0, *1fr\)\)/);
  const link = html.match(/\.case-nav-link\[[^\]]+\]\{([^}]*)\}/)?.[1] ?? '';
  assert.match(link, /min-width:0/);
  assert.match(link, /overflow-wrap:anywhere/);
});
