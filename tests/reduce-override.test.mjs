// `?reduce` reaches the CSS, not only the JS paths (#326). The layout's inline <head> script sets
// `data-reduce` on <html>; every rule inside a `prefers-reduced-motion: reduce` block has a twin keyed
// on `html[data-reduce]`, and every animation guarded by `no-preference` also requires
// `html:not([data-reduce])`. The browser behaviour (no marquee or letter animation on `/?reduce` with
// the OS setting off) is `npm run smoke`'s hero check.
// Reads dist/ only; relies on `npm test`'s pretest build (run `npm run build` first when running alone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { pageCss } from './lib/diagrams.mjs';
import { find, parseHtml, text } from './lib/html.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const article = readdirSync('dist/writing').find((d) => existsSync(`dist/writing/${d}/index.html`));
const PAGES = {
  home: 'dist/index.html',
  'case study with a diagram': 'dist/work/mts-hub/index.html',
  article: `dist/writing/${article}/index.html`,
  cv: 'dist/cv/index.html',
  404: 'dist/404.html',
};

/** The inline <head> script that mirrors `?reduce`, or undefined. */
function overrideScript(html) {
  const [head] = find(parseHtml(html), (el) => el.tag === 'head');
  return find(head, (el) => el.tag === 'script' && !el.attrs.src)
    .map((el) => text(el))
    .find((s) => s.includes('data') && /reduce/.test(s));
}

/** Runs the script against a fake page at `search`; returns <html>'s dataset. */
function runAt(script, search) {
  const dataset = {};
  vm.runInNewContext(script, { URLSearchParams, location: { search }, document: { documentElement: { dataset } } });
  return dataset;
}

/** Index of the `}` that closes the `{` at `open`, by brace depth. */
function closeOf(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces in CSS');
}

/** The bodies of every at-rule block whose prelude matches `preludeRe`. */
function blockBodies(text, preludeRe) {
  const found = [];
  const re = /@[a-z-]+[^{};]*\{/g;
  for (let m; (m = re.exec(text)); ) {
    if (!preludeRe.test(m[0].slice(0, -1).trim())) continue;
    const open = m.index + m[0].length - 1;
    found.push(text.slice(open + 1, closeOf(text, open)));
  }
  return found;
}

/** Flat rules as { selectors, decls }, declarations whitespace-free and without a trailing `;`. */
const rules = (text) =>
  [...text.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    decls: body.replace(/\s+/g, '').replace(/;$/, ''),
  }));

const REDUCE = /^@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)$/;
const NO_PREF = /^@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)$/;

/** `html` → `html[data-reduce]`; `::view-transition-*` → `html[data-reduce]::…`; anything else is a descendant. */
function twin(selector) {
  if (/^html(?![\w-])/.test(selector)) return `html[data-reduce]${selector.slice(4)}`;
  if (selector.startsWith('::')) return `html[data-reduce]${selector}`;
  return `html[data-reduce] ${selector}`;
}

test('the fixtures exist', () => {
  assert.ok(article, 'no built article under dist/writing');
  for (const file of Object.values(PAGES)) assert.ok(existsSync(file), `${file} missing`);
});

test('the twin selector mapping', () => {
  assert.equal(twin('html'), 'html[data-reduce]');
  assert.equal(twin('.marquee-track'), 'html[data-reduce] .marquee-track');
  assert.equal(twin('::view-transition-old(*)'), 'html[data-reduce]::view-transition-old(*)');
  assert.equal(twin('.hero-poster[data-astro-cid-x]'), 'html[data-reduce] .hero-poster[data-astro-cid-x]');
});

for (const [name, file] of Object.entries(PAGES)) {
  const html = readFileSync(file, 'utf8');

  test(`${name}: an inline <head> script sets data-reduce exactly when the URL has ?reduce`, () => {
    const script = overrideScript(html);
    assert.ok(script, 'no inline ?reduce script in <head>');
    assert.deepEqual(runAt(script, '?reduce'), { reduce: '' });
    assert.deepEqual(runAt(script, '?nogl&reduce=1'), { reduce: '' });
    assert.deepEqual(runAt(script, ''), {});
    assert.deepEqual(runAt(script, '?reducer&lite'), {});
  });

  test(`${name}: every reduced-motion rule has an html[data-reduce] twin with the same declarations`, () => {
    const css = pageCss(html);
    const all = rules(css);
    const inReduce = blockBodies(css, REDUCE).flatMap(rules);
    assert.ok(inReduce.length > 0, 'no prefers-reduced-motion: reduce rules');
    const missing = [];
    for (const { selectors, decls } of inReduce) {
      for (const sel of selectors) {
        const want = twin(sel);
        if (!all.some((r) => r.decls === decls && r.selectors.includes(want))) missing.push(`${want} { ${decls} }`);
      }
    }
    assert.deepEqual(missing, [], 'reduced-motion rules with no html[data-reduce] twin');
  });

  test(`${name}: every animation guarded by no-preference also requires html:not([data-reduce])`, () => {
    const css = pageCss(html);
    const animated = blockBodies(css, NO_PREF)
      .flatMap(rules)
      .filter((r) => /(^|;)animation(-name)?:/.test(r.decls));
    for (const { selectors } of animated) {
      for (const sel of selectors) assert.match(sel, /^html:not\(\[data-reduce\]\) /, `${sel} animates under ?reduce`);
    }
  });
}

test('the case study diagram ships a guarded flow animation, so the guard test above is not vacuous', () => {
  const css = pageCss(readFileSync(PAGES['case study with a diagram'], 'utf8'));
  const animated = blockBodies(css, NO_PREF)
    .flatMap(rules)
    .filter((r) => /(^|;)animation:/.test(r.decls));
  assert.ok(
    animated.some((r) => r.selectors.some((s) => s.startsWith('html:not([data-reduce]) .edge-flow'))),
    'no html:not([data-reduce]) .edge-flow animation rule',
  );
});
