// The /privacy/ notice and its footer link (#129). The page is plain, indexable and in the sitemap;
// the contact address is SITE.email; the analytics paragraph renders only while SITE.analyticsToken
// is set (it ships unset, and this slice renders no beacon). Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/lib/site.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const read = (f) => readFileSync(f, 'utf8');
const PAGE = 'dist/privacy/index.html';
const tokenSet = typeof SITE.analyticsToken === 'string' && SITE.analyticsToken !== '';
const isStub = (html) => /<meta http-equiv="refresh"/i.test(html);

function htmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) htmlFiles(p, out);
    else if (extname(p) === '.html') out.push(p);
  }
  return out;
}

test('every page on the normal layout links /privacy/; only the redirect stubs are exempt', () => {
  let stubs = 0;
  const missing = [];
  const files = htmlFiles('dist');
  for (const f of files) {
    const html = read(f);
    if (isStub(html)) {
      stubs++;
      continue;
    }
    if (!html.includes('href="/privacy/"')) missing.push(f);
  }
  assert.ok(files.length > stubs, 'expected pages besides the stubs');
  assert.ok(stubs >= 1, 'expected at least one redirect stub to be skipped');
  assert.deepEqual(missing, []);
});

test('the footer link is in the footer, and the "no tracking" line is unchanged', () => {
  const html = read('dist/index.html');
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.match(footer, /<a [^>]*href="\/privacy\/"[^>]*>Privacy<\/a>/);
  assert.match(footer, /Static HTML, no tracking\./);
});

test('/privacy/ is built, indexable, uses the default card and names both processors', () => {
  assert.ok(existsSync(PAGE), `${PAGE} missing`);
  const html = read(PAGE);
  assert.doesNotMatch(html, /noindex/i);
  assert.match(html, /<link rel="canonical" href="https:\/\/pearse\.dev\/privacy\/"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/pearse\.dev\/og-default\.png"/);
  assert.match(html, /GitHub Pages/);
  assert.match(html, /Cloudflare/);
  assert.match(html, /docs\.github\.com\/en\/site-policy\/privacy-policies\/github-general-privacy-statement/);
  assert.match(html, /cloudflare\.com\/privacypolicy\//);
});

test('/privacy/ shows SITE.email in a mailto link', () => {
  const html = read(PAGE);
  assert.ok(html.includes(SITE.email));
  assert.ok(html.includes(`href="mailto:${SITE.email}"`));
});

test('the analytics paragraph follows analyticsToken', () => {
  const html = read(PAGE);
  assert.equal(html.includes('Cloudflare Web Analytics'), tokenSet);
});

test('/privacy/ is in the sitemap', () => {
  const sitemaps = readdirSync('dist').filter((f) => /^sitemap-\d+\.xml$/.test(f));
  assert.ok(sitemaps.length >= 1);
  assert.ok(sitemaps.some((f) => read(join('dist', f)).includes('<loc>https://pearse.dev/privacy/</loc>')));
});
