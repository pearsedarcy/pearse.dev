// The "What it does in depth" heading is two inline-flex parts; without a text space
// between them textContent/accessible name read "What it doesin depth" (#69).
// Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projects } from './lib/projects.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

test('sections heading has a space between its parts', () => {
  const pages = projects().filter((p) => p.visible);
  let seen = 0;
  for (const p of pages) {
    const html = readFileSync(`dist/work/${p.slug}/index.html`, 'utf8');
    const h2 = html.match(/<h2 id="sections-title"[^>]*>([\s\S]*?)<\/h2>/)?.[1];
    if (!h2) continue;
    seen++;
    const text = h2.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    assert.equal(text, 'What it does in depth', p.slug);
  }
  assert.ok(seen > 0, 'at least one case study renders the sections heading');
});
