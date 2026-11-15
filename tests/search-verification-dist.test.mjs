// Issue #280: Search Console and Bing verification stay DNS-only (ADR 0001, the "Static HTML, no
// tracking" footer). A TXT record adds no script, no meta tag and no file to `dist/`; the HTML-tag,
// HTML-file and BingSiteAuth.xml methods all do, so this guard fails a later "quick fix" through
// any of them. The live record is asserted by `search-verification` in `npm run dns`, never here.
// Reads dist/ only; relies on `npm test`'s pretest build (run `npm run build` first when running
// this file alone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

/** A `<meta>` tag that carries a Google or Bing site-verification name, in any attribute order or quoting. */
export const VERIFICATION_META = /<meta\b[^>]*(?:google-site-verification|msvalidate\.01)/i;

/** File names the HTML-file methods create: Google's `google<token>.html` and Bing's `BingSiteAuth.xml`. */
export const VERIFICATION_FILE = /^(?:google[^/]*\.html|bingsiteauth\.xml)$/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = () => walk(DIST);

test('the meta pattern matches the verification meta tags and nothing else', () => {
  for (const tag of [
    '<meta name="google-site-verification" content="x">',
    "<meta content='x' name='google-site-verification'>",
    '<META NAME="Google-Site-Verification" CONTENT="x">',
    '<meta name="msvalidate.01" content="x" />',
    '<meta\n  name=google-site-verification\n  content=x>',
  ]) {
    assert.match(tag, VERIFICATION_META, tag);
  }
  for (const text of [
    '<meta name="description" content="x">',
    '<meta name="robots" content="index">',
    '<p>Verify with a google-site-verification TXT record</p>',
    '<meta name="description" content="x"><p>msvalidate.01</p>',
  ]) {
    assert.doesNotMatch(text, VERIFICATION_META, text);
  }
});

test('the file pattern matches the verification files and nothing else', () => {
  for (const name of ['google0123456789abcdef.html', 'Google-x.html', 'BingSiteAuth.xml', 'bingsiteauth.xml']) assert.match(name, VERIFICATION_FILE, name);
  for (const name of ['index.html', 'googleish.css', 'sitemap-index.xml', 'robots.txt', 'about.html']) assert.doesNotMatch(name, VERIFICATION_FILE, name);
});

test('no built page carries a google-site-verification or msvalidate.01 meta tag', () => {
  const html = files().filter((f) => f.endsWith('.html'));
  assert.ok(html.length > 0, 'dist/ has no HTML: run `npm run build` first');
  const hits = html.filter((f) => VERIFICATION_META.test(readFileSync(f, 'utf8'))).map((f) => relative(DIST, f));
  assert.deepEqual(hits, [], 'verification is DNS-only: remove the meta tag and add a TXT record instead');
});

test('dist/ holds no google*.html verification file and no BingSiteAuth.xml', () => {
  const hits = files().filter((f) => VERIFICATION_FILE.test(f.split('/').at(-1))).map((f) => relative(DIST, f));
  assert.deepEqual(hits, [], 'verification is DNS-only: remove the file and add a TXT record instead');
});

test('robots.txt still points at the sitemap index, and the index exists', () => {
  assert.ok(existsSync(join(DIST, 'robots.txt')), 'dist/robots.txt missing');
  assert.ok(readFileSync(join(DIST, 'robots.txt'), 'utf8').split(/\r?\n/).includes('Sitemap: https://pearse.dev/sitemap-index.xml'), 'robots.txt lost its Sitemap line');
  assert.ok(existsSync(join(DIST, 'sitemap-index.xml')), 'dist/sitemap-index.xml missing');
});
