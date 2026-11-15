// Asserts the 404 page (#137): no claim about the old site, the newest published articles and
// the featured case studies as two scoped sections, the fail-closed visibility rules, and the
// heading outline. Expected lists are derived from the source files at test time, never
// hard-coded: the daily rebuild (ADR 0003) changes which articles are live.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isVisibleProject } from '../src/lib/visibility.ts';
import { find, parseHtml, text } from './lib/html.mjs';
import { posts } from './lib/posts.mjs';
import { pendingSlugs, projects } from './lib/projects.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const html = readFileSync('dist/404.html', 'utf8');
const root = parseHtml(html);
const section = (id) => find(root, (e) => e.tag === 'section' && e.attrs.id === id)[0];
const hrefs = (node, prefix) =>
  find(node, (e) => e.tag === 'a' && (e.attrs.href ?? '').startsWith(prefix) && e.attrs.href.length > prefix.length).map(
    (e) => e.attrs.href.slice(prefix.length).replace(/\/$/, ''),
  );

const expectedPosts = posts()
  .filter((p) => p.published)
  .sort((a, b) => b.data.pubDate - a.data.pubDate)
  .slice(0, 3)
  .map((p) => p.id);
const expectedWork = projects()
  .filter((p) => p.caseStudy && p.featured)
  .sort((a, b) => a.order - b.order)
  .map((p) => p.slug);

test('the page copy makes no claim about the old site', () => {
  // The article rows are excluded: an article's own description may mention the old site (the
  // "why I rebuilt" post does, since 2026-10-24). Only the 404's own copy is under test.
  const copy = find(root, (e) => e.tag === 'section' && !['notfound-writing', 'notfound-work'].includes(e.attrs.id))
    .map(text)
    .join(' ');
  assert.match(copy, /There is nothing at this address\./);
  assert.ok(!/old site|different URLs/i.test(copy), copy);
});

test('the writing section lists the newest published articles, in order', () => {
  const s = section('notfound-writing');
  if (expectedPosts.length === 0) return assert.equal(s, undefined, 'no empty writing section');
  assert.ok(s, '#notfound-writing');
  assert.equal(s.attrs['aria-labelledby'], 'notfound-writing-title');
  assert.deepEqual(hrefs(s, '/writing/'), expectedPosts);
});

test('the work section lists the featured case studies in order', () => {
  const s = section('notfound-work');
  assert.ok(expectedWork.length > 0, 'expected at least one featured case study');
  assert.ok(s, '#notfound-work');
  assert.equal(s.attrs['aria-labelledby'], 'notfound-work-title');
  assert.deepEqual(hrefs(s, '/work/'), expectedWork);
});

test('no pending client case study and no draft or future-dated article appears', () => {
  const hidden = [...pendingSlugs(), ...posts().filter((p) => !p.published).map((p) => p.id)];
  for (const slug of hidden) assert.ok(!html.includes(slug), slug);
});

test('isVisibleProject fails closed on a featured client case study without permission', () => {
  const fixture = [
    { category: 'client', featured: true },
    { category: 'mts', featured: true },
  ];
  assert.deepEqual(fixture.filter(isVisibleProject), [{ category: 'mts', featured: true }]);
});

test('heading outline: one h1, h2s inside the two sections, article rows are h3', () => {
  const headings = find(root, (e) => /^h[1-6]$/.test(e.tag));
  assert.equal(headings.filter((h) => h.tag === 'h1').length, 1);
  const sections = ['notfound-writing', 'notfound-work'].map(section).filter(Boolean);
  const h2s = headings.filter((h) => h.tag === 'h2');
  const inSections = sections.flatMap((s) => find(s, (e) => e.tag === 'h2'));
  assert.deepEqual(h2s, inSections, 'every h2 sits inside a section');
  assert.equal(h2s.length, sections.length);
  const writing = section('notfound-writing');
  if (writing) {
    assert.equal(find(writing, (e) => e.tag === 'h3').length, expectedPosts.length);
    assert.ok(html.indexOf('id="notfound-writing"') < html.indexOf('id="notfound-work"'));
  }
  assert.ok(!headings.some((h) => h.tag === 'h4' || h.tag === 'h5'));
});
