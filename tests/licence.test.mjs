// The content-licence split (#158): LICENSE is MIT for code and points at LICENSE-CONTENT, whose line 1
// names the content licence; the built footer and the RSS <copyright> must show that same name and the
// same year. The year is never compared with `new Date()`, so the suite cannot flake around New Year.
// Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTENT_LICENCE, CONTENT_LICENCE_URL, SITE, copyrightLine } from '../src/lib/site.ts';
import { decodeEntities, textOf } from './lib/sanitise.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const read = (f) => readFileSync(f, 'utf8');
const licence = read('LICENSE');
const content = read('LICENSE-CONTENT');
const html = read('dist/index.html');
const rssXml = read('dist/rss.xml');

const nameMatch = /^Licence: (.+)$/.exec(content.split('\n')[0]);
const name = nameMatch?.[1];

const footerHtml = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
const footerPara = [...footerHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
  .map((m) => textOf(m[1]))
  .find((t) => t.includes('©'));
const feedCopyrights = [...rssXml.matchAll(/<copyright>([\s\S]*?)<\/copyright>/g)].map((m) =>
  decodeEntities(m[1]),
);
const yearOf = (s) => /\b(\d{4})\b/.exec(s ?? '')?.[1];

test('LICENSE is MIT and names LICENSE-CONTENT exactly once', () => {
  assert.equal(licence.split('\n')[0], 'MIT License');
  assert.equal(licence.split('LICENSE-CONTENT').length - 1, 1);
});

test('LICENSE-CONTENT line 1 names the licence, line 2 the copyright holder', () => {
  assert.ok(name, 'line 1 must match ^Licence: (.+)$');
  assert.match(content.split('\n')[1], /^Copyright \(c\) \d{4} Pearse D'Arcy$/);
});

test('the site constant is the same string as LICENSE-CONTENT line 1', () => {
  assert.equal(CONTENT_LICENCE.name, name);
  assert.equal(CONTENT_LICENCE.file, 'LICENSE-CONTENT');
});

test('LICENSE-CONTENT names its scope, excludes the og scripts and does not relicense third parties', () => {
  for (const path of ['src/content/', 'docs/profile/', 'public/og-default.png', 'public/og/']) {
    assert.ok(content.includes(path), `scope must name ${path}`);
  }
  const flat = content.replace(/\s+/g, ' ');
  assert.match(flat, /scripts\/og-\*\.mjs/);
  assert.match(flat, /gitignored/);
  assert.match(flat, /not relicensed/);
});

test('the built footer states the licence name and a four-digit year, and links LICENSE-CONTENT', () => {
  assert.ok(footerPara, 'footer has a © paragraph');
  assert.ok(footerPara.includes(name), `footer must contain "${name}"`);
  assert.match(footerPara, /\b\d{4}\b/);
  assert.ok(footerPara.includes('Code: MIT'));
  const link = new RegExp(`<a[^>]*href="${CONTENT_LICENCE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
  assert.match(footerHtml, link);
  assert.ok(CONTENT_LICENCE_URL.startsWith(`${SITE.repo}/blob/master/`));
});

test('the feed has exactly one <copyright> with the same name and year as the footer', () => {
  assert.equal(feedCopyrights.length, 1);
  assert.ok(feedCopyrights[0].includes(name), `feed must contain "${name}"`);
  assert.ok(yearOf(feedCopyrights[0]));
  assert.equal(yearOf(feedCopyrights[0]), yearOf(footerPara));
  assert.equal(feedCopyrights[0], copyrightLine(Number(yearOf(feedCopyrights[0]))));
});
