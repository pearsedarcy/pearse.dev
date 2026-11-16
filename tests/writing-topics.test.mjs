// The /writing/ Topics row is plain text, not a row of controls (#299). It used to render each tag
// as a bordered `.chip`, which looks like a filter button but did nothing on click. The lowest-JS
// fix is to restyle it as metadata: no link, no button, no chip class, and no border, padding or
// pointer cursor in its CSS. Ships no script, so the page's JS budget is unchanged.
// The row lists the tags of the live posts, which change daily (ADR 0003), so the checks accept
// any number of items and read the list only when it is rendered.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { find, hasClass, parseHtml, text } from './lib/html.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${ROOT}/dist/writing/index.html`, 'utf8');
const doc = parseHtml(html);
const lists = find(doc, (e) => e.tag === 'ul' && e.attrs['aria-label'] === 'Topics');
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

/** Every rule body whose selector names `.topics`. */
const topicsRules = () => [...css.matchAll(/([^{}]*\.topics[^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

test('/writing/ renders at most one Topics list, with the topics class', () => {
  assert.ok(lists.length <= 1, `${lists.length} Topics lists`);
  for (const ul of lists) assert.ok(hasClass(ul, 'topics'), 'ul.topics');
});

test('the Topics items are plain text: no link, button, chip or interactive attribute', () => {
  for (const ul of lists) {
    const lis = find(ul, (e) => e.tag === 'li');
    assert.ok(lis.length > 0, 'a rendered Topics list has items');
    for (const li of lis) {
      const label = text(li).trim();
      assert.ok(label.length > 0, 'item has text');
      assert.ok(!hasClass(li, 'chip'), `"${label}" is not a chip`);
      assert.equal(find(li, (e) => ['a', 'button', 'input', 'label'].includes(e.tag)).length, 0, `"${label}" has no control`);
      for (const attr of ['role', 'tabindex', 'onclick', 'aria-pressed']) assert.equal(li.attrs[attr], undefined, `"${label}" has no ${attr}`);
    }
  }
});

test('the Topics CSS draws no border or pointer cursor', () => {
  if (lists.length === 0) return; // no live posts today: nothing rendered, nothing to style
  const rules = topicsRules();
  assert.ok(rules.length > 0, 'a .topics rule is inlined in the page');
  const list = rules.find((r) => /\.topics(?![\w-])(?:\[[^\]]*\]|:where\([^)]*\))*$/.test(r.selector));
  assert.ok(list, `a rule for the list itself among: ${rules.map((r) => r.selector).join(' | ')}`);
  assert.match(list.body, /list-style:\s*none/, 'no bullets');
  for (const { selector, body } of rules) {
    assert.doesNotMatch(body, /(?:^|;)\s*border(?:-[a-z-]+)?\s*:/, `${selector}: no border`);
    assert.doesNotMatch(body, /cursor:\s*pointer/, `${selector}: no pointer cursor`);
  }
});

test('the Topics separator trails the item before it, so a wrapped line never starts with a dot (#334)', () => {
  if (lists.length === 0) return;
  const rules = topicsRules();
  // A leading separator (li + li::before) is what put a dot at the start of the second line at 390px.
  assert.equal(rules.filter((r) => /::?before/.test(r.selector)).length, 0, 'no ::before separator on .topics');
  const sep = rules.find((r) => /::?after/.test(r.selector));
  assert.ok(sep, 'a ::after separator rule');
  assert.match(sep.selector, /:not\(:last-child\)/, 'the last item gets no trailing dot');
  assert.doesNotMatch(sep.selector, /li\s*\+\s*li|~/, 'not a sibling-combinator (leading) rule');
});

test('the Topics separator is hidden from screen readers where alt text is supported', () => {
  if (lists.length === 0) return;
  const sep = topicsRules().find((r) => /::?after/.test(r.selector));
  assert.ok(sep, 'a ::after separator rule');
  // The minifier may write the escape `\00b7` as the literal middle dot.
  assert.match(sep.body, /content:\s*["'](?:\\00b7|\u00b7)["']\s*\/\s*["']{2}/, 'content with empty alt text');
});

test('/writing/ ships no script for the Topics row', () => {
  // The fix is CSS only (#299): the page still carries no inline script mentioning topics.
  const scripts = find(parseHtml(html), (el) => el.tag === 'script').map((el) => text(el));
  for (const s of scripts) assert.doesNotMatch(s, /topics/i, 'no Topics script');
});
