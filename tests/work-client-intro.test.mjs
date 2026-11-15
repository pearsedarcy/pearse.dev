// The /work/ page names WordPress and WooCommerce in its meta description and lede, and the
// "Client work" group carries one intro built from CLIENT_INTRO and the canonical PROCESS_STEPS (#272).
// The intro may claim only the process steps that every visible client case study with a WordPress
// stack entry lists, so a claim that drifts from the case studies fails here. When it does, change
// `steps` in CLIENT_INTRO (src/lib/site.ts), not this test.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projects } from './lib/projects.mjs';
import { find, parseHtml, text } from './lib/html.mjs';
import { CLIENT_INTRO } from '../src/lib/site.ts';
import { PROCESS_STEPS } from '../src/lib/process.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const root = parseHtml(readFileSync('dist/work/index.html', 'utf8'));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const step = (id) => PROCESS_STEPS.find((s) => s.id === id);

/** Visible client case studies whose stack has an entry led by the token "wordpress" ("WordPress 7.1" counts). */
const wordpressClients = () =>
  projects().filter(
    (p) =>
      p.visible &&
      p.category === 'client' &&
      (p.stack ?? []).some((s) => String(s).trim().split(/[\s,+/]+/)[0].toLowerCase() === 'wordpress'),
  );

const clientSection = () => find(root, (e) => e.tag === 'section' && e.attrs['aria-labelledby'] === 'group-client')[0];
const introEls = (node) => find(node, (e) => 'data-group-intro' in e.attrs);

test('CLIENT_INTRO claims only steps every WordPress client case study lists', () => {
  const studies = wordpressClients();
  assert.ok(studies.length > 0, 'no visible client case study has a WordPress stack entry');
  assert.ok(CLIENT_INTRO.steps.length > 0, 'CLIENT_INTRO claims no steps');
  for (const id of CLIENT_INTRO.steps) {
    assert.ok(step(id), `unknown process step "${id}"`);
    for (const p of studies) {
      const listed = (p.process ?? []).map((x) => x.step);
      assert.ok(listed.includes(id), `CLIENT_INTRO claims "${id}" but ${p.slug} does not list it (lists: ${listed.join(', ')})`);
    }
  }
});

test('the WordPress client set matching is case-insensitive on the leading token', () => {
  const slugs = wordpressClients().map((p) => p.slug);
  assert.ok(slugs.length > 0);
  // east-coast-blinds names WordPress only in prose, never in its stack
  assert.ok(!slugs.includes('east-coast-blinds'));
});

test('exactly one data-group-intro, inside the client section, between its h2 and its card grid', () => {
  assert.equal(introEls(root).length, 1, 'expected exactly one data-group-intro on the page');
  const section = clientSection();
  assert.ok(section, 'no section with aria-labelledby="group-client"');
  assert.equal(introEls(section).length, 1);
  const kids = section.children.filter((c) => typeof c !== 'string');
  const h2 = kids.findIndex((e) => e.tag === 'h2');
  const intro = kids.findIndex((e) => 'data-group-intro' in e.attrs);
  const grid = kids.findIndex((e) => (e.attrs.class ?? '').split(/\s+/).includes('grid'));
  assert.ok(h2 >= 0 && intro >= 0 && grid >= 0, 'h2, intro or card grid missing');
  assert.ok(h2 < intro && intro < grid, `child order must be h2, intro, grid (got ${h2}, ${intro}, ${grid})`);
  for (const other of find(root, (e) => e.tag === 'section' && /^group-/.test(e.attrs['aria-labelledby'] ?? '') && e !== section)) {
    assert.equal(introEls(other).length, 0, `${other.attrs['aria-labelledby']} must not have an intro`);
  }
});

test('the intro uses the canonical wording of claimed steps, none of the unclaimed, and every platform', () => {
  const intro = norm(text(introEls(root)[0]));
  for (const id of CLIENT_INTRO.steps) {
    assert.ok(intro.includes(step(id).title), `intro lacks the title of "${id}": ${intro}`);
  }
  for (const s of PROCESS_STEPS.filter((s) => !CLIENT_INTRO.steps.includes(s.id))) {
    assert.ok(!intro.includes(s.title), `intro uses the unclaimed title "${s.title}"`);
    assert.ok(!intro.includes(s.promise), `intro uses the unclaimed promise of "${s.id}"`);
  }
  for (const platform of CLIENT_INTRO.platforms) assert.ok(intro.includes(platform), `intro lacks "${platform}"`);
});

test('the lede and the meta description name WordPress and WooCommerce', () => {
  const h1 = find(root, (e) => e.tag === 'h1')[0];
  assert.ok(h1);
  const main = h1.parent;
  const after = main.children.filter((c) => typeof c !== 'string').slice(main.children.filter((c) => typeof c !== 'string').indexOf(h1) + 1);
  const lede = after.find((e) => e.tag === 'p');
  assert.ok(lede, 'no <p> after the h1');
  const t = norm(text(lede));
  assert.ok(t.includes('WordPress') && t.includes('WooCommerce'), `lede: ${t}`);
  const metas = find(root, (e) => e.tag === 'meta' && e.attrs.name === 'description');
  assert.equal(metas.length, 1);
  const d = metas[0].attrs.content;
  assert.ok(d.includes('WordPress') && d.includes('WooCommerce'), `description: ${d}`);
});
