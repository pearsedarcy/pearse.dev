// Byte budgets for the assets a phone downloads: JavaScript, fonts and OG cards (issue #290).
//
// Why: only Lighthouse guarded weight before this. It scores five URLs, the score is noisy, and it
// skips the daily rebuild (#154). A dependency bump or a careless import could add a hundred
// kilobytes and every other suite would stay green. Each asset below has a budget, kept in the one
// BUDGETS table, and the suite fails with the file, its size, the budget and the gap.
//
// What each budget guards:
//   three      the three.js chunk, found by its `three.` name prefix. A three.js minor bump may trip it.
//              Several matching chunks (a future split) are added together; none is a failure.
//   motion     the GSAP motion chunk, found by its `motion.` prefix. Exactly one must exist.
//   eagerJs    per HTML page: every `<script type="module" src>` plus the chunks those scripts load
//              through STATIC `import ... from "./x.js"`, gzipped and added up. Dynamic `import()` is
//              not counted. The scene entries (Hero, StackObject) list three.js in `__vite__mapDeps`,
//              but that list only feeds the dynamic import behind the scene gate (#99), so the walk
//              ignores it by construction: it follows `from"./x.js"` and bare `import"./x.js"` edges
//              only. A fixture test below pins that. The three.js chunk is also never eager, and no
//              page may reference it from a script src, a modulepreload link or a preload link.
//   fonts      raw woff2 bytes (gzip does nothing to woff2), one budget per family, about 5% above the
//              size when the budget was set. dist ships exactly three woff2 files: a fourth means a new
//              subset or family went live without anyone deciding it.
//   OG cards   raw PNG bytes. Per-page cards in dist/og/ share one budget. The site-wide default card
//              has its own, because its job and artwork differ.
//
// JavaScript is measured gzipped with zlib at level 9, so the numbers are deterministic. A KB here is
// 1024 bytes. The sizes in the comments are what master measured when the budget was written.
//
// To raise a budget: edit its row in BUDGETS, put the new measurement in the comment beside it, and
// say in the PR why the weight is worth it. A reviewer then sees a one-line change, not a silent drift.
// Do not shrink assets to fit in the same PR as a budget change.
//
// Relies on `npm test`'s pretest build and only reads dist/; run `npm run build` first when running
// this file alone. It builds and writes nothing itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { posix, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { find, parseHtml } from './lib/html.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const KB = 1024;

export const BUDGETS = {
  // JavaScript, gzipped.
  three: { prefix: 'three.', gz: 135 * KB }, //          three.module.*.js 531,221 B raw, 130,575 B gz
  motion: { prefix: 'motion.', gz: 50 * KB }, //         motion.*.js 120,889 B raw, 47,136 B gz
  eagerJs: { gz: 8 * KB }, //                            home page eager set 3,205 B gz (Hero, StackObject, Base, scene-gate, preload-helper)
  // Fonts, raw bytes.
  fontFiles: 3, //                                       woff2 files in dist
  fonts: {
    archivo: { prefix: 'archivo-', bytes: 95 * KB }, //               90,104 B
    inter: { prefix: 'inter-', bytes: 51 * KB }, //                   48,256 B
    jetbrainsMono: { prefix: 'jetbrains-mono-', bytes: 43 * KB }, //  40,404 B
  },
  // OG cards, raw bytes.
  ogCard: { bytes: 80 * KB }, //                         dist/og/*.png, largest 65,418 B
  // The issue (#290) budgeted 105 KB here from a 101,921 B card. #278 has since re-encoded the
  // default card to 36,630 B and og.test.mjs holds it to 50 KB, so the budget follows the measurement.
  ogDefault: { bytes: 50 * KB }, //                      dist/og-default.png 36,630 B
};

// ---- helpers (pure; exercised below with fixtures) ------------------------------------------

export const gz = (buf) => gzipSync(buf, { level: 9 }).length;

const kb = (n) => `${(Math.abs(n) / KB).toFixed(1)} KB`;
const budgetKb = (n) => `${Number((n / KB).toFixed(1))} KB`;

/** A failure message, or null when `measured` fits `budget`. `unit` is 'gz' or '' (raw). */
export function overBudget(label, measured, budget, unit = '') {
  if (measured <= budget) return null;
  return `${label} ${kb(measured)}${unit ? ` ${unit}` : ''} > ${budgetKb(budget)} (+${kb(measured - budget)})`;
}

/**
 * Relative specifiers of the STATIC imports in a built chunk: `import{a}from"./x.js"`,
 * `export*from"./x.js"` and bare `import"./x.js"`. Dynamic `import("./x.js")` and the
 * `__vite__mapDeps` string array are not edges, so neither is returned.
 */
export function staticImports(js) {
  const out = new Set();
  for (const m of js.matchAll(/\bfrom\s*["'`](\.{1,2}\/[^"'`]+)["'`]/g)) out.add(m[1]);
  for (const m of js.matchAll(/(?:^|[;{}\n])\s*import\s*["'`](\.{1,2}\/[^"'`]+)["'`]/g)) out.add(m[1]);
  return [...out];
}

/**
 * Every chunk an HTML page loads eagerly, as dist-relative paths: its module script entries and the
 * transitive static imports of each. `read(path)` returns a chunk's source and throws when missing.
 */
export function eagerSet(entries, read) {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const spec of staticImports(read(path))) visit(posix.join(posix.dirname(path), spec));
  };
  entries.forEach(visit);
  return seen;
}

/** dist-relative src of every `<script type="module" src>` in a page, `/_astro/x.js` -> `_astro/x.js`. */
export function moduleScripts(html) {
  return find(parseHtml(html), (el) => el.tag === 'script' && el.attrs.type === 'module' && el.attrs.src)
    .map((el) => el.attrs.src.replace(/^\//, ''));
}

/** hrefs that load a file through a script src, a modulepreload link or a preload link. */
export function loadedHrefs(html) {
  const loaded = [];
  for (const el of find(parseHtml(html), (e) => e.tag === 'script' || e.tag === 'link')) {
    if (el.tag === 'script' && el.attrs.src) loaded.push(el.attrs.src);
    const rel = (el.attrs.rel ?? '').toLowerCase().split(/\s+/);
    if (el.tag === 'link' && el.attrs.href && (rel.includes('modulepreload') || rel.includes('preload'))) {
      loaded.push(el.attrs.href);
    }
  }
  return loaded;
}

const isThree = (href) => posix.basename(href.split(/[?#]/)[0]).startsWith(BUDGETS.three.prefix);

// ---- dist readers ---------------------------------------------------------------------------

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

const ASTRO = 'dist/_astro';
const astroFiles = (ext) => readdirSync(ASTRO).filter((f) => f.endsWith(ext)).sort();
const readChunk = (path) => readFileSync(join('dist', path), 'utf8');
const failures = (list) => assert.equal(list.length, 0, `\n${list.join('\n')}`);

// ---- budget formatting ----------------------------------------------------------------------

test('overBudget: names the asset, size, budget and gap; passes at exactly the budget', () => {
  assert.equal(overBudget('motion.*.js', 52.3 * KB, 50 * KB, 'gz'), 'motion.*.js 52.3 KB gz > 50 KB (+2.3 KB)');
  assert.equal(overBudget('x.woff2', 50 * KB, 50 * KB), null);
  assert.equal(overBudget('x.woff2', 50 * KB + 1, 50 * KB)?.startsWith('x.woff2 50.0 KB > 50 KB (+0.0 KB)'), true);
  assert.equal(overBudget('x.png', 100, 200), null);
});

// ---- JavaScript -----------------------------------------------------------------------------

test('the three.js chunk fits its gzipped budget', () => {
  const { prefix, gz: budget } = BUDGETS.three;
  const chunks = astroFiles('.js').filter((f) => f.startsWith(prefix));
  assert.ok(chunks.length > 0, `no chunk in ${ASTRO} starts with "${prefix}"`);
  const total = chunks.reduce((sum, f) => sum + gz(readFileSync(join(ASTRO, f))), 0);
  failures([overBudget(chunks.join(' + '), total, budget, 'gz')].filter(Boolean));
});

test('the GSAP motion chunk fits its gzipped budget', () => {
  const { prefix, gz: budget } = BUDGETS.motion;
  const chunks = astroFiles('.js').filter((f) => f.startsWith(prefix));
  assert.equal(chunks.length, 1, `expected exactly one "${prefix}*.js" in ${ASTRO}, found ${chunks.length}: ${chunks.join(', ')}`);
  failures([overBudget(`${prefix}*.js`, gz(readFileSync(join(ASTRO, chunks[0]))), budget, 'gz')].filter(Boolean));
});

const pages = walk('dist', '.html').map((file) => ({ file, html: readFileSync(file, 'utf8') }));

test('dist has pages to measure', () => {
  assert.ok(pages.length > 0, 'no .html files under dist');
  assert.ok(pages.some((p) => p.file === join('dist', 'index.html')), 'dist/index.html missing');
});

test('eager JavaScript on every page fits its gzipped budget', () => {
  const found = [];
  for (const { file, html } of pages) {
    const set = eagerSet(moduleScripts(html), readChunk);
    const total = [...set].reduce((sum, path) => sum + gz(readFileSync(join('dist', path))), 0);
    found.push(overBudget(`${file} eager JS (${set.size} files)`, total, BUDGETS.eagerJs.gz, 'gz'));
  }
  failures(found.filter(Boolean));
});

test('the three.js chunk is never eager and no page references it', () => {
  const found = [];
  for (const { file, html } of pages) {
    for (const path of eagerSet(moduleScripts(html), readChunk)) {
      if (isThree(path)) found.push(`${file}: eager set includes ${path}`);
    }
    for (const href of loadedHrefs(html)) {
      if (isThree(href)) found.push(`${file}: loads ${href} from a script src, modulepreload or preload`);
    }
  }
  failures(found);
});

// Fixture test: the built entries look like these. The __vite__mapDeps array names three.js, the
// import() is dynamic, and only the `from"./..."` edge is a static dependency.
const HERO_ENTRY = [
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_astro/hero.A.js","_astro/preload-helper.B.js","_astro/three.module.C.js"])))=>i.map(i=>d[i]);',
  'import{t as e}from"./scene-gate.D.js";import{a as t}from"./preload-helper.B.js";',
  'async()=>{let{mountHero:e}=await import(`./hero.A.js`);return e}',
  'await t(async()=>import(`./three.module.C.js`),__vite__mapDeps([0,1,2]))',
].join('\n');

test('staticImports follows from-edges and bare imports, not mapDeps or dynamic import()', () => {
  assert.deepEqual(staticImports(HERO_ENTRY).sort(), ['./preload-helper.B.js', './scene-gate.D.js']);
  assert.deepEqual(staticImports('import"./side.js";export*from"./re.js";import("./dyn.js")').sort(), ['./re.js', './side.js']);
  assert.deepEqual(staticImports('const x=Array.from("./not-an-edge.js")'), []);
});

test('eagerSet counts static edges once and leaves the mapDeps-only three.js chunk out', () => {
  const files = {
    '_astro/hero-entry.js': HERO_ENTRY,
    '_astro/stack-entry.js': 'import{t as e}from"./scene-gate.D.js";import{a as t}from"./preload-helper.B.js";',
    '_astro/scene-gate.D.js': 'export{x as t};',
    '_astro/preload-helper.B.js': 'export{y as a};',
    '_astro/three.module.C.js': 'export{z as t};',
    '_astro/hero.A.js': 'import{t as n}from"./three.module.C.js";',
  };
  const read = (p) => {
    if (!(p in files)) throw new Error(`missing ${p}`);
    return files[p];
  };
  const set = eagerSet(['_astro/hero-entry.js', '_astro/stack-entry.js'], read);
  assert.deepEqual([...set].sort(), ['_astro/hero-entry.js', '_astro/preload-helper.B.js', '_astro/scene-gate.D.js', '_astro/stack-entry.js']);
  assert.equal([...set].some(isThree), false);
  // A static edge to three.js, by contrast, is eager.
  assert.equal(eagerSet(['_astro/hero.A.js'], read).has('_astro/three.module.C.js'), true);
  assert.throws(() => eagerSet(['_astro/gone.js'], read), /missing _astro\/gone\.js/);
});

test('loadedHrefs sees a three.js script src, modulepreload and preload', () => {
  const html = (head) => `<!doctype html><html><head>${head}</head><body></body></html>`;
  const bad = [
    '<link rel="modulepreload" href="/_astro/three.module.X.js">',
    '<link rel="preload" as="script" href="/_astro/three.module.X.js">',
    '<script type="module" src="/_astro/three.module.X.js"></script>',
    '<script src="/_astro/three.module.X.js"></script>',
  ];
  for (const tag of bad) assert.equal(loadedHrefs(html(tag)).some(isThree), true, tag);
  const fine = html('<link rel="preload" as="font" href="/_astro/inter-latin.X.woff2"><script type="module" src="/_astro/Hero.X.js"></script>');
  assert.equal(loadedHrefs(fine).some(isThree), false);
  assert.deepEqual(moduleScripts(fine), ['_astro/Hero.X.js']);
});

// ---- fonts ----------------------------------------------------------------------------------

test('dist ships exactly three woff2 files', () => {
  const files = walk('dist', '.woff2');
  assert.equal(files.length, BUDGETS.fontFiles, `expected ${BUDGETS.fontFiles} woff2 files, found ${files.length}: ${files.join(', ')}`);
});

test('each font family fits its raw-byte budget', () => {
  const woff2 = astroFiles('.woff2');
  const found = [];
  for (const [family, { prefix, bytes }] of Object.entries(BUDGETS.fonts)) {
    const files = woff2.filter((f) => f.startsWith(prefix));
    if (files.length !== 1) {
      found.push(`${family}: expected one "${prefix}*.woff2" in ${ASTRO}, found ${files.length}`);
      continue;
    }
    found.push(overBudget(files[0], statSync(join(ASTRO, files[0])).size, bytes));
  }
  failures(found.filter(Boolean));
});

// ---- OG cards -------------------------------------------------------------------------------

test('each per-page OG card fits its raw-byte budget', () => {
  const cards = readdirSync('dist/og').filter((f) => f.endsWith('.png')).sort();
  assert.ok(cards.length > 0, 'no cards in dist/og');
  failures(cards.map((f) => overBudget(`og/${f}`, statSync(join('dist/og', f)).size, BUDGETS.ogCard.bytes)).filter(Boolean));
});

test('the default OG card fits its own raw-byte budget', () => {
  failures([overBudget('og-default.png', statSync('dist/og-default.png').size, BUDGETS.ogDefault.bytes)].filter(Boolean));
});
