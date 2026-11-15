// Asserts the home marquee becomes a static wrapped list under reduced motion (#269), and still
// loops under default motion. The browser measurement is the smoke run's `marquee` check; this
// reads the built home page's CSS only. Also pins WHERE the rules sit, because that decides
// whether they win: the list rules are Astro-scoped and unlayered, the track rule is unlayered
// in the reduce block, and nothing in an @layer can beat either, so only unlayered rules count.
// Reads dist/ only; relies on `npm test`'s pretest build (run `npm run build` first when running alone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageCss } from './lib/diagrams.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const css = pageCss(readFileSync('dist/index.html', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

/** Index of the `}` that closes the `{` at `open`, by brace depth. */
function closeOf(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces in CSS');
}

/** Every at-rule block whose prelude matches `preludeRe`, as { prelude, body, start, end }. */
function blocks(text, preludeRe) {
  const found = [];
  const re = /@[a-z-]+[^{};]*\{/g;
  for (let m; (m = re.exec(text)); ) {
    const prelude = m[0].slice(0, -1).trim();
    if (!preludeRe.test(prelude)) continue;
    const open = m.index + m[0].length - 1;
    const end = closeOf(text, open);
    found.push({ prelude, body: text.slice(open + 1, end), start: m.index, end });
  }
  return found;
}

/** Style rules `selectors { declarations }` at the top level of `body`, with declarations as a Map. */
function rules(body) {
  const out = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map(
      m[2]
        .split(';')
        .map((d) => d.split(/:(.*)/s).map((s) => s?.trim()))
        .filter(([k, v]) => k && v)
        .map(([k, v]) => [k, v.replace(/\s*!important$/, '')]),
    );
    out.push({ selectors: m[1].split(',').map((s) => s.trim()), decls });
  }
  return out;
}

const REDUCE = /^@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)$/;
const reduce = blocks(css, REDUCE);
const layers = blocks(css, /^@layer\b/);
/** Rules in the reduce blocks, flagged when the block sits inside an @layer (those lose to unlayered rules). */
const reduceRules = reduce.flatMap((b) => {
  const layered = layers.some((l) => l.start < b.start && b.end < l.end);
  return rules(b.body).map((r) => ({ ...r, layered }));
});
const SCOPE = '(?:\\[data-astro-cid-[\\w-]+\\])?';
const matches = (sel, re) => re.test(sel);
// Only unlayered rules count: the track rule in @layer components and a layered override lose to the scoped list rules.
const ruleFor = (list, re) => list.filter((r) => !r.layered && r.selectors.some((s) => matches(s, re)));

/** The CSS with every reduce block cut out: what default-motion visitors get. */
const outsideReduce = reduce.reduceRight((t, b) => t.slice(0, b.start) + t.slice(b.end + 1), css);

test('the built home page ships a reduced-motion block', () => {
  assert.ok(reduce.length > 0, 'no prefers-reduced-motion: reduce block in the home page CSS');
});

test('reduced motion: the track stops being a max-content row', () => {
  const found = ruleFor(reduceRules, /^\.marquee-track$/);
  assert.ok(found.length > 0, 'no unlayered .marquee-track rule inside a reduce block');
  const ok = found.some((r) => {
    const width = r.decls.get('width');
    return r.decls.get('display') === 'block' || (width !== undefined && width !== 'max-content');
  });
  assert.ok(ok, 'the reduce .marquee-track rule neither sets display: block nor a non-max-content width');
});

test('reduced motion: the first .marquee-list wraps and takes the band width', () => {
  const found = ruleFor(reduceRules, new RegExp(`^\\.marquee-list${SCOPE}$`));
  assert.ok(found.length > 0, 'no unlayered .marquee-list rule inside a reduce block');
  const wraps = found.some((r) => r.decls.get('flex-wrap') === 'wrap');
  assert.ok(wraps, 'no reduce .marquee-list rule sets flex-wrap: wrap');
  const unshrinks = found.some((r) => {
    const shrink = r.decls.get('flex-shrink');
    return r.decls.get('width') === '100%' || (shrink !== undefined && shrink !== '0');
  });
  assert.ok(unshrinks, 'no reduce .marquee-list rule undoes flex-shrink: 0 or sets width: 100%');
});

test('reduced motion: the aria-hidden duplicate copy is display: none', () => {
  // Any attribute-selector spelling (quotes or none), with or without the Astro scope suffix.
  const hidden = new RegExp(`^\\.marquee-list(?:${SCOPE.slice(3, -2)})*\\[aria-hidden=(?:"true"|'true'|true)\\](?:${SCOPE.slice(3, -2)})*$`);
  const found = ruleFor(reduceRules, hidden);
  assert.ok(found.length > 0, 'no unlayered .marquee-list[aria-hidden="true"] rule inside a reduce block');
  assert.ok(found.some((r) => r.decls.get('display') === 'none'), 'the hidden copy is not display: none (visibility or opacity still take up layout space)');
});

test('reduced motion: the marquee animation stays off', () => {
  const off = ruleFor(reduceRules, /(^|,)\.marquee-track$/).some((r) => r.decls.get('animation') === 'none');
  assert.ok(off, 'the reduce block no longer sets animation: none on .marquee-track');
});

test('default motion: the track is still a max-content flex row with the marquee animation', () => {
  const base = rules(outsideReduce).filter((r) => r.selectors.includes('.marquee-track'));
  assert.ok(base.length > 0, 'no default .marquee-track rule outside the reduce blocks');
  const d = Object.fromEntries(base.flatMap((r) => [...r.decls]));
  assert.equal(d.width, 'max-content');
  assert.match(d.animation ?? '', /\bmarquee\b/);
  assert.equal(d.display, 'flex');
});

test('default motion: the list and its hidden copy are not hidden or wrapped outside the reduce block', () => {
  const scoped = rules(outsideReduce).filter((r) => r.selectors.some((s) => new RegExp(`^\\.marquee-list${SCOPE}$`).test(s)));
  assert.ok(scoped.length > 0, 'no default .marquee-list rule');
  assert.ok(scoped.some((r) => r.decls.get('flex-shrink') === '0'), 'default .marquee-list lost flex-shrink: 0');
  assert.ok(scoped.every((r) => r.decls.get('flex-wrap') !== 'wrap' && r.decls.get('display') !== 'none'), 'a default .marquee-list rule wraps or hides the list');
  const hiddenOutside = rules(outsideReduce).some((r) => r.selectors.some((s) => /aria-hidden/.test(s) && /marquee-list/.test(s)) && r.decls.get('display') === 'none');
  assert.ok(!hiddenOutside, 'the duplicate copy is hidden outside the reduce block');
});
