// Phone widths keep the 16 px side gutter (#346). The browser measurement is the smoke run's
// `overflow` check (scripts/smoke/smoke.mjs: 360, 320 and 305 px, then 320 and 390 px windows with a
// real classic scrollbar (#359), scrollWidth plus the gutter);
// these tests pin what produces it: the grids whose lone column used to grow to the min-content of
// a display word now use minmax(0, 1fr), and the two display sizes shrink with the viewport below
// the width where their longest word no longer fits. Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageCss } from './lib/diagrams.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const read = (f) => readFileSync(f, 'utf8');
/** [prefix, body] of every top-level rule (not inside an at-rule) whose selector contains every one of `parts`. */
const topLevelRules = (css, ...parts) => {
  const flat = css.replace(/\s+/g, ' ');
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (flat[i] === '}') {
      depth--;
    }
    if (flat[i] === '}' && depth === 0) {
      const head = flat.slice(0, start).split(/[{}]/).pop();
      const body = flat.slice(start + 1, i);
      if (!body.includes('{') && parts.every((p) => head.includes(p))) out.push(body);
    }
  }
  return out;
};

test('the home About grid is one minmax(0, 1fr) column below 64rem, so the H2 cannot widen it', () => {
  const css = pageCss(read('dist/index.html'));
  const base = topLevelRules(css, '.about-grid[').join(';');
  assert.match(base, /display: ?grid/);
  assert.match(base, /grid-template-columns: ?minmax\(0, ?1fr\)/, 'base .about-grid column');
});

test('the home GitHub grid is one minmax(0, 1fr) column below 64rem', () => {
  const css = pageCss(read('dist/index.html'));
  assert.match(topLevelRules(css, '.gh-grid[').join(';'), /grid-template-columns: ?minmax\(0, ?1fr\)/, 'base .gh-grid column');
});

test('the article prev/next nav columns can shrink below their titles', () => {
  const css = pageCss(read('dist/writing/why-i-rebuilt-pearse-dev/index.html'));
  assert.match(topLevelRules(css, '.post-nav[').join(';'), /grid-template-columns: ?repeat\(2, ?minmax\(0, ?1fr\)\)/, '.post-nav columns');
  assert.match(topLevelRules(css, '.post-nav-link[').join(';'), /overflow-wrap: ?anywhere/, '.post-nav-link wraps long words');
});

test('the display sizes drop with the viewport so the longest word fits a 16 px gutter at 320 px', () => {
  const css = pageCss(read('dist/index.html'));
  assert.match(css, /--text-3xl: ?clamp\(min\(2\.5rem, ?11\.5vw\), ?1\.5rem \+ 3\.5vw, ?4\.25rem\)/, '--text-3xl');
  assert.match(css, /--text-4xl: ?clamp\(min\(2\.75rem, ?13vw\), ?1rem \+ 7vw, ?7\.5rem\)/, '--text-4xl');
});

test('the smoke overflow check covers 320 px, 320 px less a 15 px scrollbar, and the 16 px gutter', () => {
  const smoke = read('scripts/smoke/smoke.mjs');
  assert.match(smoke, /const WIDTHS = \[360, 320, 305\]/);
  assert.match(smoke, /const GUTTER = 16/);
  assert.match(smoke, /inside the \$\{GUTTER\}px right gutter/);
});

test('the hero name is capped at its container width, so a classic scrollbar cannot push it into the gutter (#359)', () => {
  const css = pageCss(read('dist/index.html'));
  // vw counts a 15 px classic scrollbar; cqi on .hero is the content box the page really has.
  assert.match(topLevelRules(css, '.hero[').join(';'), /container-type: ?inline-size/, '.hero is the query container');
  // 5.125em is the widest line ("PEARSE", 5.12em at wdth 125); the vw token still sets the size without a bar.
  assert.match(topLevelRules(css, '.hero-name[').join(';'), /font-size: ?min\(var\(--text-display\), ?100cqi ?\/ ?5\.125\)/, '.hero-name font-size');
  assert.match(css, /--text-display: ?clamp\(3rem, ?17\.4vw, ?16rem\)/, '--text-display is unchanged');
});

test('the home "Selected work" heading is capped at the #work container width for the same reason (#359)', () => {
  const css = pageCss(read('dist/index.html'));
  assert.match(topLevelRules(css, '#work[').join(';'), /container-type: ?inline-size/, '#work is the query container');
  // "Selected" is 6.635em; --text-4xl's 13vw floor ended it 3 px into the gutter at 320 px with a bar.
  assert.match(topLevelRules(css, '#work-title[').join(';'), /font-size: ?min\(var\(--text-4xl\), ?100cqi ?\/ ?6\.64\)/, '#work-title font-size');
});

test('the smoke overflow check runs 320 and 390 px windows with a real classic scrollbar (#359)', () => {
  const smoke = read('scripts/smoke/smoke.mjs');
  assert.match(smoke, /const SCROLLBAR_WIDTHS = \[320, 390\]/);
  assert.match(smoke, /launchBrowser\(chrome, \{ scrollbars: true \}\)/, 'a second browser keeps its scrollbars');
  assert.match(smoke, /no page drew a classic scrollbar/, 'a run where no page drew a bar fails instead of passing silently');
  assert.match(read('scripts/smoke/harness.mjs'), /ignoreDefaultArgs: \['--hide-scrollbars'\]/, 'headless Chrome hides scrollbars unless told not to');
});
