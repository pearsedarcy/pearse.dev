// Asserts the /work/ sequence (#54): card numbers run 01..N in grid order, each case
// study's eyebrow number matches its card, Previous/Next walks the grid in order, and
// `order` values are unique so the sequence cannot depend on a tie.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projects } from './lib/projects.mjs';
import { CATEGORY_ORDER, caseNumber, compareWork, earliestYear } from '../src/lib/work-order.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const read = (path) => readFileSync(path, 'utf8');
/** [slug, number] for every card on /work/, in document (grid) order. */
const cards = () =>
  [...read('dist/work/index.html').matchAll(/<a href="\/work\/([a-z0-9-]+)\/" class="card\b[^>]*>\s*<div class="card-meta[^>]*>\s*<span[^>]*>(\d+)<\/span>/g)].map(
    (m) => [m[1], m[2]],
  );
const page = (slug) => read(`dist/work/${slug}/index.html`);
/** The number in a case study's eyebrow label. */
const eyebrow = (slug) => page(slug).match(/<header class="case-head[^>]*>\s*<p class="label[^>]*>\s*<b[^>]*>(\d+)<\/b>/)?.[1];
/** Where a case study's Next link points: a slug, or 'index' for the closing "All work" link. */
const next = (slug) => {
  const nav = page(slug).match(/<nav class="case-nav[\s\S]*?<\/nav>/)?.[0] ?? '';
  const links = [...nav.matchAll(/<a href="\/work\/([a-z0-9-]*)\/?" class="case-nav-link[^"]*"[^>]*>\s*<span class="label[^>]*>(\w+)</g)];
  const n = links.find((m) => m[2] === 'Next' || m[2] === 'Index');
  return n?.[2] === 'Index' ? 'index' : n?.[1];
};

test('`order` is unique across case studies', () => {
  const seen = new Map();
  for (const p of projects()) {
    assert.ok(!seen.has(p.order), `${p.file} and ${seen.get(p.order)} share order ${p.order}`);
    seen.set(p.order, p.file);
  }
});

test('/work/ card numbers are unique and consecutive in grid order', () => {
  const nums = cards().map(([, n]) => n);
  assert.equal(nums.length, projects().filter((p) => p.visible).length);
  assert.deepEqual(nums, nums.map((_, i) => caseNumber(i)));
});

test('/work/ grid follows category groups, then `order`', () => {
  const expected = projects()
    .filter((p) => p.visible)
    .sort(compareWork)
    .map((p) => p.slug);
  assert.deepEqual(cards().map(([slug]) => slug), expected);
  const ranks = cards().map(([slug]) => CATEGORY_ORDER.indexOf(projects().find((p) => p.slug === slug).category));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'a category appears out of its group');
});

test('each case study eyebrow number matches its /work/ card', () => {
  for (const [slug, n] of cards()) assert.equal(eyebrow(slug), n, slug);
});

test('Next walks the /work/ grid in order and ends at the index', () => {
  const slugs = cards().map(([slug]) => slug);
  slugs.forEach((slug, i) => assert.equal(next(slug), slugs[i + 1] ?? 'index', `Next from ${slug}`));
});

test('compareWork breaks an `order` tie by slug', () => {
  const a = { category: 'tool', order: 3, slug: 'a' };
  const b = { category: 'tool', order: 3, slug: 'b' };
  const m = { category: 'mts', order: 99, slug: 'z' };
  assert.deepEqual([b, a, m].sort(compareWork), [m, a, b]);
});

test('/work/ header start year is the earliest year in any visible project period', () => {
  const years = projects()
    .filter((p) => p.visible)
    .flatMap((p) => [...p.period.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0])));
  const html = read('dist/work/index.html');
  assert.match(html, new RegExp(`projects, ${Math.min(...years)} to now`));
});

test('earliestYear reads the minimum year from free-form periods', () => {
  assert.equal(earliestYear(['Mar – Apr 2024', '2022 – 2026', 'Feb 2025']), 2022);
  assert.equal(earliestYear(['ongoing']), undefined);
});
