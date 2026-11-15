// Issue #164: scripts/check-links.mjs over temporary dist trees. Fragments, self-absolute URLs and
// the feeds (rss.xml, the sitemaps, social.json). Never reads the real dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ORIGIN } from '../src/lib/origin.mjs';

const script = resolve('scripts/check-links.mjs');

const page = (body) => `<!doctype html><html><body>${body}</body></html>`;

/** A dist tree that satisfies every rule. `over` replaces or adds files by dist-relative path. */
function tree(over = {}) {
  return {
    'index.html': page(
      `<h1 id="top-heading">Home</h1>` +
        `<a href="/a/#sec">valid fragment</a><a href="#">empty</a><a href="#top">top</a><a href="#here">same page</a>` +
        `<p id="here"></p><a href="${ORIGIN}/a/">self-absolute</a><a href="${ORIGIN}/a/#sec">self-absolute fragment</a>` +
        `<a href="/rss.xml#x">feed with fragment</a><a href="https://example.com/elsewhere/">external, skipped</a>`,
    ),
    'a/index.html': page(`<section id="sec"><h2 id="caf%C3%A9-x">x</h2><div id="café"></div></section>`),
    'rss.xml':
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><link>${ORIGIN}/</link>` +
      `<item><link>${ORIGIN}/a/</link><guid isPermaLink="true">${ORIGIN}/a/</guid></item></channel></rss>`,
    'sitemap-index.xml': `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
    'sitemap-0.xml': `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/a/</loc></url></urlset>`,
    'social.json': JSON.stringify(social()),
    ...over,
  };
}

function social(extra = []) {
  return [
    {
      kind: 'article',
      url: `${ORIGIN}/a/`,
      published: true,
      social: { linkedin: `Read it (${ORIGIN}/a/).\nMore soon.`, short: `New post: ${ORIGIN}/a/#sec!` },
    },
    { kind: 'standalone', published: true, social: { linkedin: 'No link here.', short: 'Nor here. https://example.com/x' } },
    { kind: 'article', url: `${ORIGIN}/scheduled/`, published: false, social: { linkedin: `Soon: ${ORIGIN}/scheduled/`, short: 'x' } },
    ...extra,
  ];
}

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'links-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      if (content === null) continue;
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const missingLines = (r) => r.stdout.split('\n').filter((l) => l.startsWith('MISSING '));

test('all green: every rule satisfied exits 0', () => {
  const r = run(tree());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(missingLines(r), []);
  assert.match(r.stdout, /^2 pages, \d+ internal references checked$/m);
  assert.match(r.stdout, /All internal links resolve\./);
});

test('a missing fragment target fails with the unchanged MISSING line', () => {
  const r = run(tree({ 'index.html': page('<a href="/a/#gone">x</a>') }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), ['MISSING /a/#gone  <- /index.html']);
});

test('a fragment that only matches data-id does not count', () => {
  const r = run(tree({ 'index.html': page('<a href="/b/#gone">x</a>'), 'b/index.html': page('<div data-id="gone"></div>') }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), ['MISSING /b/#gone  <- /index.html']);
});

test('a pure fragment points at the current page', () => {
  const r = run(tree({ 'index.html': page('<p id="here"></p><a href="#here">ok</a><a href="#nothere">bad</a>') }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), ['MISSING #nothere  <- /index.html']);
});

test('a percent-encoded fragment matches its decoded id', () => {
  const r = run(tree({ 'index.html': page('<a href="/a/#caf%C3%A9">x</a>') }));
  assert.equal(r.status, 0, r.stdout);
});

test('a fragment pointing at a meta-refresh redirect page fails', () => {
  const redirect = '<!doctype html><meta http-equiv="refresh" content="1;url=/a/"><body><a href="/a/">moved</a></body>';
  const r = run(tree({ 'index.html': page('<a href="/old/#sec">x</a>'), 'old/index.html': redirect }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), ['MISSING /old/#sec  <- /index.html']);
});

test('a fragment on a non-HTML target needs the file only', () => {
  assert.equal(run(tree({ 'index.html': page('<a href="/rss.xml#anything">x</a>') })).status, 0);
  const r = run(tree({ 'index.html': page('<a href="/nope.xml#x">x</a>') }));
  assert.deepEqual(missingLines(r), ['MISSING /nope.xml#x  <- /index.html']);
});

test('a self-absolute URL to a missing page fails and names the page', () => {
  const r = run(tree({ 'a/index.html': page(`<p id="sec"></p><a href="${ORIGIN}/nope/">x</a>`) }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), [`MISSING ${ORIGIN}/nope/  <- /a/index.html`]);
});

test('a self-absolute URL with a missing fragment fails with the full URL', () => {
  const r = run(tree({ 'index.html': page(`<a href="${ORIGIN}/a/#gone">x</a>`) }));
  assert.deepEqual(missingLines(r), [`MISSING ${ORIGIN}/a/#gone  <- /index.html`]);
});

test('rss.xml: a bad <link> and a bad attributed <guid> each fail, named by the feed', () => {
  const rss =
    `<rss version="2.0"><channel><link>${ORIGIN}/</link><item><link>${ORIGIN}/bad-link/</link>` +
    `<guid isPermaLink="true">${ORIGIN}/bad-guid/</guid></item></channel></rss>`;
  const r = run(tree({ 'rss.xml': rss }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), [`MISSING ${ORIGIN}/bad-link/  <- /rss.xml`, `MISSING ${ORIGIN}/bad-guid/  <- /rss.xml`]);
});

test('a child sitemap <loc> is followed from the index and fails named by the child', () => {
  const r = run(tree({ 'sitemap-0.xml': `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/gone/</loc></url></urlset>` }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), [`MISSING ${ORIGIN}/gone/  <- /sitemap-0.xml`]);
});

test('a sitemap index naming a missing child sitemap fails', () => {
  const r = run(tree({ 'sitemap-0.xml': null }));
  assert.deepEqual(missingLines(r), [`MISSING ${ORIGIN}/sitemap-0.xml  <- /sitemap-index.xml`]);
});

test('social.json: a bad published url fails named by the feed', () => {
  const r = run(tree({ 'social.json': JSON.stringify(social([{ url: `${ORIGIN}/bad-url/`, published: true }])) }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), [`MISSING ${ORIGIN}/bad-url/  <- /social.json`]);
});

test('social.json: a URL in social.linkedin is trimmed of ")." and never carries the \\n', () => {
  const entry = { published: true, social: { linkedin: `See it (${ORIGIN}/bad-copy/).\nThanks`, short: 'x' } };
  const r = run(tree({ 'social.json': JSON.stringify(social([entry])) }));
  assert.equal(r.status, 1);
  assert.deepEqual(missingLines(r), [`MISSING ${ORIGIN}/bad-copy/  <- /social.json`]);
});

test('social.json: a URL in social.short is checked too', () => {
  const entry = { published: true, social: { linkedin: 'x', short: `Out now: ${ORIGIN}/bad-short/!` } };
  assert.deepEqual(missingLines(run(tree({ 'social.json': JSON.stringify(social([entry])) }))), [
    `MISSING ${ORIGIN}/bad-short/  <- /social.json`,
  ]);
});

test('social.json: an unpublished entry with a missing page passes, url and copy both skipped', () => {
  const entry = { url: `${ORIGIN}/later/`, published: false, social: { linkedin: `${ORIGIN}/later/`, short: `${ORIGIN}/later/` } };
  const r = run(tree({ 'social.json': JSON.stringify(social([entry])) }));
  assert.equal(r.status, 0, r.stdout);
});

test('one MISSING line per URL, listing every source', () => {
  const r = run(tree({ 'index.html': page('<a href="/nope/">x</a>'), 'b/index.html': page('<a href="/nope/">y</a>') }));
  assert.deepEqual(missingLines(r), ['MISSING /nope/  <- /b/index.html, /index.html']);
});
