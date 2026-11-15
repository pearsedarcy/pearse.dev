// The Older/Newer nav at the foot of an article and of a case study keeps its columns inside the box (#347).
// `1fr` has an auto minimum, so a long title widened its column and pushed the right-aligned link into the
// gutter at 320 px. The browser measurement is the smoke run; these tests pin the rules that produce it.
// Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageCss } from './lib/diagrams.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const read = (f) => readFileSync(f, 'utf8');
/** Bodies of the rules whose selector is exactly `sel` (Astro scopes as `.x[data-astro-cid-…]`). */
const rules = (css, sel) =>
  [...css.replace(/\s+/g, ' ').matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => m[1].trim().replace(/\[data-astro-cid-[\w-]+\]/g, '') === sel)
    .map((m) => m[2])
    .join(';');

const firstPage = (dir) => {
  const slug = readdirSync(dir, { withFileTypes: true }).find((d) => d.isDirectory() && !d.name.startsWith('_'))?.name;
  assert.ok(slug, `${dir}: a built page`);
  return read(`${dir}/${slug}/index.html`);
};

for (const [name, dir, nav, link] of [
  ['article', 'dist/writing', '.post-nav', '.post-nav-link'],
  ['case study', 'dist/work', '.case-nav', '.case-nav-link'],
]) {
  test(`${name} nav: two columns that cannot grow past their share`, () => {
    const css = pageCss(firstPage(dir));
    const grid = rules(css, nav);
    assert.match(grid, /grid-template-columns: ?repeat\(2, ?minmax\(0, ?1fr\)\)/, `${nav} columns`);
    assert.doesNotMatch(grid, /grid-template-columns: ?1fr 1fr/, `${nav} is not plain 1fr 1fr`);
  });

  test(`${name} nav: a long title wraps inside its link`, () => {
    const css = pageCss(firstPage(dir));
    const l = rules(css, link);
    assert.match(l, /min-width: ?0/, `${link} min-width`);
    assert.match(l, /overflow-wrap: ?anywhere/, `${link} overflow-wrap`);
  });
}
