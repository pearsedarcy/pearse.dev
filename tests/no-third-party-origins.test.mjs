// No built page loads anything from an origin outside the allowlist (#115, #129): the footer says
// "Static HTML, no tracking", so a visit must not send the visitor's IP anywhere but pearse.dev.
// The allowlist is `allowedOrigins(SITE.analyticsToken)`: this site alone, plus Cloudflare's
// beacon host once #20 sets the token. The walker is tests/lib/origins.mjs, the only one.
// Scope: markup and CSS only. Fetches started by JavaScript in _astro/*.js are not scanned.
// Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/lib/site.ts';
import { allowedOrigins, foreignOrigin, offenders, resourceUrls } from './lib/origins.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const urls = (html) => resourceUrls(html).map((x) => x.url);

test('allowedOrigins: this site alone, plus the beacon host only for a non-empty token', () => {
  assert.deepEqual(allowedOrigins(undefined), ['https://pearse.dev']);
  assert.deepEqual(allowedOrigins(''), ['https://pearse.dev']);
  assert.deepEqual(allowedOrigins('abc'), ['https://pearse.dev', 'https://static.cloudflareinsights.com']);
});

test('resourceUrls: srcset candidates lose their descriptors', () => {
  assert.deepEqual(urls('<img src="/a.jpg" srcset="/a-80.jpg 80w, https://z.example/a-2x.jpg 2x">'), ['/a.jpg', '/a-80.jpg', 'https://z.example/a-2x.jpg']);
  assert.deepEqual(urls('<picture><source srcset="/a.avif 1x,/b.avif 2x" type="image/avif"></picture>'), ['/a.avif', '/b.avif']);
});

test('resourceUrls: link rel matches on space-separated tokens', () => {
  assert.deepEqual(urls('<link rel="shortcut icon" href="/f.ico">'), ['/f.ico']);
  assert.deepEqual(urls('<link rel="canonical" href="https://elsewhere.example/x">'), []);
  const rels = ['stylesheet', 'icon', 'apple-touch-icon', 'preload', 'modulepreload', 'prefetch', 'manifest'];
  for (const rel of rels) assert.deepEqual(urls(`<link rel="${rel}" href="/x">`), ['/x'], rel);
  for (const rel of ['alternate', 'sitemap', 'me', 'iconic']) assert.deepEqual(urls(`<link rel="${rel}" href="/x">`), [], rel);
});

test('resourceUrls: <a href> and xmlns are not fetches', () => {
  assert.deepEqual(urls('<a href="https://github.com/x">out</a><svg xmlns="http://www.w3.org/2000/svg"></svg>'), []);
});

test('resourceUrls: <img> and <source> inside <noscript> are included', () => {
  assert.deepEqual(urls('<noscript><img src="https://n.example/p.gif"><picture><source srcset="https://n.example/q.webp"></picture></noscript>'), ['https://n.example/p.gif', 'https://n.example/q.webp']);
});

test('resourceUrls: the other src tags, poster, object data and input[type=image]', () => {
  const html = `<script src="/a.js"></script><iframe src="/f"></iframe><video src="/v.mp4" poster="/p.jpg"></video>
    <audio src="/a.mp3"></audio><embed src="/e.swf"><object data="/o.svg"></object>
    <input type="image" src="/i.png"><input type="text" src="/ignored">`;
  assert.deepEqual(urls(html), ['/a.js', '/f', '/v.mp4', '/p.jpg', '/a.mp3', '/e.swf', '/o.svg', '/i.png']);
});

test('resourceUrls: SVG <use> and <image>, href and xlink:href', () => {
  assert.deepEqual(urls('<svg><use href="/sprite.svg#a"></use><use xlink:href="https://s.example/s.svg#b"></use><image href="/i.png"></image></svg>'), ['/sprite.svg#a', 'https://s.example/s.svg#b', '/i.png']);
});

test('resourceUrls: @import and url() in <style> and style attributes, quoted and not', () => {
  const html = `<style>@import "https://f.example/a.css"; @import 'https://f.example/b.css'; @import url(https://f.example/c.css);
    .a { background: url("//cdn.example/b.png") } .b { background: url(/c.png) } .c { fill: url(#m); mask: url(%23n) }</style>
    <p style="background:url('https://y.example/c.png')"></p>`;
  assert.deepEqual(urls(html), ['https://f.example/c.css', '//cdn.example/b.png', '/c.png', '#m', '%23n', 'https://f.example/a.css', 'https://f.example/b.css', 'https://y.example/c.png']);
});

test('resourceUrls: entities are decoded; script bodies are not read', () => {
  assert.deepEqual(urls('<img src="/a.png?x=1&amp;y=2&#38;z=3&#x26;w=4">'), ['/a.png?x=1&y=2&z=3&w=4']);
  assert.deepEqual(urls(`<script>var s = '<img src="https://in-script.example/x.png">'</script>`), []);
});

test('foreignOrigin: relative, fragment, data and own-origin URLs are same-origin', () => {
  for (const u of ['', '/a.png', 'a.png', '#id', '%23n', 'data:image/svg+xml,%3Csvg%3E', 'https://pearse.dev/og/x.png']) assert.equal(foreignOrigin(u), undefined, u);
  assert.equal(foreignOrigin('//cdn.example/b.png'), 'https://cdn.example');
  assert.equal(foreignOrigin('https://pearse.dev.evil.example/x.png'), 'https://pearse.dev.evil.example');
  assert.equal(foreignOrigin('http://pearse.dev/x.png'), 'http://pearse.dev');
  assert.equal(foreignOrigin('javascript:alert(1)'), 'null');
});

test('offenders: the beacon host passes only with a token', () => {
  const html = '<script src="https://static.cloudflareinsights.com/beacon.min.js"></script><img src="https://x.example/i.png">';
  assert.deepEqual(offenders(html, allowedOrigins(undefined)).map((o) => o.origin), ['https://static.cloudflareinsights.com', 'https://x.example']);
  assert.deepEqual(offenders(html, allowedOrigins('abc')).map((o) => o.origin), ['https://x.example']);
});

const pages = () => walk('dist').filter((f) => extname(f) === '.html');

test('every built page, redirect stubs included, loads only from allowed origins', () => {
  const files = pages();
  assert.ok(files.length >= 10, `expected the built pages, found ${files.length}`);
  const allowed = allowedOrigins(SITE.analyticsToken);
  const bad = [];
  let checked = 0;
  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    checked += resourceUrls(html).length;
    for (const o of offenders(html, allowed)) bad.push(`${f}: ${o.where} loads from ${o.origin} (${o.url})`);
  }
  assert.ok(checked > 50, `parsed ${checked} resource URLs`);
  assert.deepEqual(bad, []);
});

test('with the token unset, "cloudflareinsights" appears in no built HTML file', (t) => {
  if (typeof SITE.analyticsToken === 'string' && SITE.analyticsToken !== '') return t.skip('analyticsToken is set');
  const hits = pages().filter((f) => readFileSync(f, 'utf8').toLowerCase().includes('cloudflareinsights'));
  assert.deepEqual(hits, []);
});

test('the GitHub avatar CDN is named in no built HTML, CSS or JS file', () => {
  const files = walk('dist').filter((f) => ['.html', '.css', '.js', '.mjs'].includes(extname(f)));
  assert.ok(files.length > 10);
  const hits = files.filter((f) => readFileSync(f, 'utf8').includes('avatars.githubusercontent.com'));
  assert.deepEqual(hits, []);
});
