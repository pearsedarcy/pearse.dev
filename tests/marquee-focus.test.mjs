// Keyboard focus on the hero marquee stays on screen (#301). The browser behaviour (every link on
// screen when focused, the drift stopping, the reset on leaving) is `npm run smoke`'s `marquee`
// check; this reads the built home page for the pieces that check relies on.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { find, hasClass, parseHtml } from './lib/html.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const html = readFileSync('dist/index.html', 'utf8');
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

/** The declarations of the first rule whose selector list contains `selector`. */
function declarations(selector) {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').some((s) => s.trim() === selector)) return m[2];
  }
  return null;
}

test('focus inside the marquee stops the animation and resets the transform', () => {
  const rule = declarations('.marquee:focus-within .marquee-track');
  assert.ok(rule, 'a .marquee:focus-within .marquee-track rule ships');
  assert.match(rule, /animation:\s*none/);
  assert.match(rule, /transform:\s*none/);
});

test('hover still only pauses the drift, and the focus rule is not a pause', () => {
  const hover = declarations('.marquee:hover .marquee-track');
  assert.ok(hover, 'the hover rule ships on its own');
  assert.match(hover, /animation-play-state:\s*paused/);
  assert.doesNotMatch(css, /\.marquee:focus-within[^{]*\{[^}]*animation-play-state/);
});

test('the band reserves scroll padding so the focus outline is not clipped at its edge', () => {
  assert.match(declarations('.marquee') ?? '', /scroll-padding-inline:/);
});

test('the home page ships the focus handler: scroll the focused link in, reset on leave', () => {
  assert.match(html, /addEventListener\(`?["']?focusin/);
  assert.match(html, /scrollIntoView\(\{block:["'`]nearest["'`],inline:["'`]nearest["'`]\}\)/);
  assert.match(html, /addEventListener\(`?["']?focusout/);
  assert.match(html, /scrollLeft=0/);
});

test('only the first copy of the marquee links is in the tab order', () => {
  const doc = parseHtml(html);
  const lists = find(doc, (e) => hasClass(e, 'marquee-list'));
  assert.equal(lists.length, 2);
  const tabbable = (list) => find(list, (e) => e.tag === 'a' && e.attrs.tabindex !== '-1').length;
  assert.ok(tabbable(lists[0]) > 0, 'the first copy has links in the tab order');
  assert.equal(tabbable(lists[1]), 0, 'the aria-hidden copy has none');
});
