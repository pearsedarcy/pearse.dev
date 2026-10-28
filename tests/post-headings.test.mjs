// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

function levels(file) {
  const main = readFileSync(file, 'utf8').split('<main')[1] ?? '';
  return [...main.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
}

test('/writing/ heading outline skips no levels', () => {
  const ls = levels('dist/writing/index.html');
  assert.equal(ls[0], 1);
  for (let i = 1; i < ls.length; i++) assert.ok(ls[i] - ls[i - 1] <= 1, `h${ls[i - 1]} -> h${ls[i]}`);
  assert.ok(ls.includes(2));
});

test('home "Recent posts" keeps h2 then h3 titles', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const i = html.indexOf('Recent posts');
  assert.ok(i > 0);
  assert.match(html.slice(i, i + 2500), /<h3[^>]*post-title/);
});
