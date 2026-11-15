// Icons and web manifest (#281), generated at build from public/favicon.svg. Relies on `npm test`'s
// pretest build; run `npm run build` first when running this file alone. Reads dist/ only.
// The helper test at the bottom needs no build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { SITE } from '../src/lib/site.ts';
import { rasterIcon } from '../src/lib/icons.ts';
import { find, parseHtml } from './lib/html.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const indexHtml = () => readFileSync('dist/index.html', 'utf8');
const links = (root, rel) =>
  find(root, (e) => e.tag === 'link' && (e.attrs.rel ?? '').toLowerCase().split(/\s+/).includes(rel));
const meta = (root, key, value) => find(root, (e) => e.tag === 'meta' && e.attrs[key] === value);

for (const [file, size] of [
  ['apple-touch-icon', 180],
  ['icon-192', 192],
  ['icon-512', 512],
]) {
  test(`dist/${file}.png is a ${size}x${size} PNG with 3 channels`, async () => {
    const buf = readFileSync(`dist/${file}.png`);
    assert.deepEqual(buf.subarray(0, 8), PNG_SIGNATURE);
    const m = await sharp(buf).metadata();
    assert.equal(m.format, 'png');
    assert.equal(m.width, size);
    assert.equal(m.height, size);
    assert.equal(m.channels, 3);
  });
}

test('the manifest carries the site names, the two PNG icons and the shared colour', () => {
  const m = JSON.parse(readFileSync('dist/site.webmanifest', 'utf8'));
  assert.equal(m.name, SITE.name);
  assert.ok(m.name.includes('’'), 'the apostrophe stays curly');
  assert.equal(m.short_name, SITE.shortName);
  assert.equal(m.start_url, '/');
  assert.equal(m.display, 'browser');
  assert.deepEqual(
    m.icons.map((i) => [i.src, i.sizes, i.type]),
    [
      ['/icon-192.png', '192x192', 'image/png'],
      ['/icon-512.png', '512x512', 'image/png'],
    ],
  );
  for (const i of m.icons) assert.ok(existsSync(`dist${i.src}`), `${i.src} exists in dist/`);
});

test('the manifest colours equal the theme-color meta, and both are the shared constant', () => {
  const m = JSON.parse(readFileSync('dist/site.webmanifest', 'utf8'));
  const [theme] = meta(parseHtml(indexHtml()), 'name', 'theme-color');
  assert.ok(theme, 'theme-color meta on the home page');
  assert.equal(theme.attrs.content, SITE.themeColor);
  assert.equal(m.theme_color, theme.attrs.content);
  assert.equal(m.background_color, theme.attrs.content);
});

test('the home head has one apple-touch-icon link, one manifest link and the SVG icon first', () => {
  const html = indexHtml();
  assert.equal((html.match(/rel="apple-touch-icon"/g) ?? []).length, 1);
  assert.equal((html.match(/rel="manifest"/g) ?? []).length, 1);
  const root = parseHtml(html);
  const [touch] = links(root, 'apple-touch-icon');
  assert.equal(touch.attrs.href, '/apple-touch-icon.png');
  const [manifest] = links(root, 'manifest');
  assert.equal(manifest.attrs.href, '/site.webmanifest');
  const icons = links(root, 'icon');
  assert.equal(icons.length, 1);
  assert.equal(icons[0].attrs.href, '/favicon.svg');
  assert.equal(icons[0].attrs.type, 'image/svg+xml');
  const head = find(root, (e) => e.tag === 'link');
  const order = (el) => head.indexOf(el);
  assert.ok(order(icons[0]) < order(touch), 'the SVG icon comes before the apple-touch-icon');
});

test('og:site_name is SITE.shortName', () => {
  const [m] = meta(parseHtml(indexHtml()), 'property', 'og:site_name');
  assert.equal(m.attrs.content, SITE.shortName);
});

test('the icon files and the manifest are not in the sitemaps or the RSS feed', () => {
  const files = readdirSync('dist').filter((f) => /^sitemap-.*\.xml$/.test(f));
  assert.ok(files.length > 0, 'a sitemap exists');
  const corpus = [...files.map((f) => readFileSync(`dist/${f}`, 'utf8')), readFileSync('dist/rss.xml', 'utf8')].join('\n');
  for (const p of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest']) {
    assert.ok(!corpus.includes(p), `${p} is not listed`);
  }
});

test('no PNG is tracked under public/ except og-default.png', () => {
  const out = execFileSync('git', ['ls-files', 'public/*.png'], { encoding: 'utf8' });
  assert.deepEqual(out.split('\n').filter(Boolean), ['public/og-default.png']);
});

test('rasterIcon makes an opaque 3-channel PNG of the requested size from an SVG with transparency', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="4" height="8" fill="#000"/></svg>';
  const png = await rasterIcon(svg, 32);
  const m = await sharp(png).metadata();
  assert.equal(m.format, 'png');
  assert.equal(m.width, 32);
  assert.equal(m.height, 32);
  assert.equal(m.channels, 3);
  // The transparent right half is painted with the tile colour, not black.
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * 32 + x) * 3, (y * 32 + x) * 3 + 3)];
  assert.deepEqual(px(28, 16), [0xc6, 0xff, 0x3d]);
  assert.deepEqual(px(2, 16), [0, 0, 0]);
});
