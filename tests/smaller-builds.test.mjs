// Asserts the /work/ "Smaller builds" list (#169, ADR 0007): entries with `smallerBuild: true`
// are one compact row each in <section id="smaller-builds">, sorted by `order`, after the last
// category group. A row links its public repo or says "Private repository", and never links a
// /work/<slug>/ page, because a smaller build has none. Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projects, smallerBuildSlugs } from './lib/projects.mjs';
import { textOf } from './lib/sanitise.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

// The four one-sentence case studies folded into the list on 2026-11-15. Hard-coded on purpose,
// in `order`; update it when content changes.
const EXPECTED = ['mx-creative-keypad', 'cam-tests', 'chatterbox', 'tournament-brackets'];

const work = () => readFileSync('dist/work/index.html', 'utf8');
const bySlug = new Map(projects().map((p) => [p.slug, p]));

/** The smaller-builds section of the built /work/ page. */
function section() {
  const html = work();
  const start = html.indexOf('<section id="smaller-builds"');
  assert.notEqual(start, -1, '<section id="smaller-builds" on /work/');
  return html.slice(start, html.indexOf('</section>', start));
}

/** Each row as [slug, html], in page order. */
function rows() {
  return section()
    .split(/(?=<li\b[^>]*data-smaller-build=")/)
    .slice(1)
    .map((row) => [row.match(/data-smaller-build="([a-z0-9-]+)"/)[1], row]);
}

test('exactly the expected four entries set smallerBuild: true', () => {
  assert.deepEqual(smallerBuildSlugs(), EXPECTED);
  for (const slug of EXPECTED) assert.equal(bySlug.get(slug)?.smallerBuild, true, slug);
});

test('/work/ has one smaller-builds section, after the last category group', () => {
  const html = work();
  assert.equal(html.match(/id="smaller-builds"/g)?.length, 1);
  const last = Math.max(...[...html.matchAll(/<section\b[^>]*aria-labelledby="group-(?!smaller)/g)].map((m) => m.index));
  assert.ok(html.indexOf('<section id="smaller-builds"') > last, 'smaller builds come after every category group');
});

test('the section is numbered as the next group after the category groups', () => {
  const html = work();
  const groups = [...html.matchAll(/<h2 id="group-(?!smaller)[^"]*"[^>]*>\s*<b>(\d+)<\/b>/g)].map((m) => m[1]);
  const own = section().match(/<h2 id="group-smaller-builds"[^>]*>\s*<b>(\d+)<\/b>\s*Smaller builds/)?.[1];
  assert.ok(own, 'numbered "Smaller builds" heading');
  assert.equal(Number(own), groups.length + 1);
});

test('one row per smaller build, in `order`: mx-creative-keypad, cam-tests, chatterbox, tournament-brackets', () => {
  assert.deepEqual(
    rows().map(([slug]) => slug),
    EXPECTED,
  );
});

test('each row shows title, oneLiner, period and stack, and is not a card', () => {
  for (const [slug, row] of rows()) {
    const p = bySlug.get(slug);
    const text = textOf(row);
    for (const field of [p.title, p.oneLiner, p.period, ...p.stack]) assert.ok(text.includes(field), `${slug}: ${field}`);
  }
  assert.doesNotMatch(section(), /class="[^"]*\bcard\b/, 'no .card in the list');
});

test('public rows link their frontmatter repo as "Public repository"; the private row does not link', () => {
  for (const [slug, row] of rows()) {
    const p = bySlug.get(slug);
    if (p.visibility === 'private') {
      assert.match(row, /Private repository/, slug);
      assert.doesNotMatch(row, /href="[^"]*github\.com/, `${slug}: no github.com href`);
      assert.doesNotMatch(row, /<a\b/, `${slug}: no link at all`);
    } else {
      assert.ok(p.repo, `${slug}: public with a repo`);
      const links = [...row.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      assert.equal(links.length, 1, `${slug}: one link`);
      assert.equal(links[0][1], p.repo, slug);
      assert.equal(links[0][2].trim(), 'Public repository', slug);
    }
  }
  assert.equal(bySlug.get('mx-creative-keypad').visibility, 'private');
});

test('no row links a /work/<slug>/ page, and no smaller build has a page of its own', () => {
  assert.doesNotMatch(section(), /href="\/work\//);
  for (const slug of EXPECTED) {
    const file = `dist/work/${slug}/index.html`;
    // Only the redirect stub (tests/mts-products.test.mjs) lives at the old path.
    if (existsSync(file)) assert.match(readFileSync(file, 'utf8'), /<meta http-equiv="refresh"/, file);
  }
});

test('smaller builds are not on the home grid, /cv/ or in the social feed', () => {
  const home = readFileSync('dist/index.html', 'utf8');
  const cv = readFileSync('dist/cv/index.html', 'utf8');
  const feed = readFileSync('dist/social.json', 'utf8');
  for (const slug of EXPECTED) {
    assert.equal(home.includes(`href="/work/${slug}/"`), false, `home: ${slug}`);
    assert.equal(cv.includes(`/work/${slug}/`), false, `cv: ${slug}`);
    assert.equal(feed.includes(`/work/${slug}/`), false, `feed: ${slug}`);
  }
});
