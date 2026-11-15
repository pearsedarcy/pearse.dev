#!/usr/bin/env node
/**
 * Crawl dist/ and verify every internal link resolves to a built file (#164).
 * Usage: node scripts/check-links.mjs [dist]
 *
 * Checked: every href/src in a page that is root-relative (`/x/`), a pure fragment (`#x`, the page
 * itself) or self-absolute (its origin is ORIGIN); the <link> and <guid> text of rss.xml; the <loc>
 * text of sitemap-index.xml and of every sitemap it lists; and in social.json, for each entry with
 * `published: true`, its `url` and the URLs inside `social.linkedin` and `social.short`. Only
 * self-origin URLs are checked in the feeds. Other absolute URLs are left to the weekly external
 * check (.github/workflows/link-rot.yml).
 *
 * A `#fragment` must match an element id in the target page (percent-decoded). `#` alone and `#top`
 * are always valid. A target that is not HTML (/rss.xml#x, a PDF) must exist; its fragment is not
 * checked. Node built-ins only.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ORIGIN } from '../src/lib/origin.mjs';

const dist = resolve(process.argv[2] ?? 'dist');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

/**
 * The built file a root-relative URL points at, or null. A pure fragment (or an empty path) is the
 * page it appears on, `from`, which is null for a feed.
 */
function resolves(url, from = null) {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean) return from;
  const candidates = [
    join(dist, clean),
    join(dist, clean, 'index.html'),
    join(dist, `${clean}.html`),
    join(dist, clean.replace(/\/$/, '') + '.html'),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

// A word boundary is not enough: `\bid=` also matches `data-id=`.
const ID = /(?<![\w-])id=["']([^"']+)["']/g;
const idCache = new Map();
function idsOf(file) {
  let ids = idCache.get(file);
  if (!ids) {
    ids = new Set([...readFileSync(file, 'utf8').matchAll(ID)].map((m) => m[1]));
    idCache.set(file, ids);
  }
  return ids;
}

function fragmentOk(file, url) {
  const at = url.indexOf('#');
  if (at < 0 || !file.endsWith('.html')) return true;
  let fragment;
  try {
    fragment = decodeURIComponent(url.slice(at + 1));
  } catch {
    return false; // malformed percent-encoding cannot name an id
  }
  return fragment === '' || fragment === 'top' || idsOf(file).has(fragment);
}

/** The root-relative form of a self-origin absolute URL, or null for any other URL. */
function selfPath(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  return u.origin === ORIGIN ? `${u.pathname}${u.search}${u.hash}` : null;
}

const missing = new Map();
let checked = 0;

/** Check one root-relative or pure-fragment `path`; report it as `url` from `source`. */
function check(url, path, source, from = null) {
  checked++;
  const file = resolves(path, from);
  if (file && fragmentOk(file, path)) return;
  const list = missing.get(url) ?? [];
  list.push(source);
  missing.set(url, list);
}

const rel = (file) => file.slice(dist.length).split(sep).join('/');

const pages = walk(dist);
const attr = /\b(?:href|src)=["']([^"']+)["']/g;

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(attr)) {
    const url = m[1];
    if (url.startsWith('#') || (url.startsWith('/') && !url.startsWith('//'))) check(url, url, rel(page), page);
    else {
      const path = selfPath(url);
      if (path !== null) check(url, path, rel(page), page);
    }
  }
}

// Feeds: only self-origin URLs are checked, each named by its feed file.
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (all, dec, hex, name) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (XML_ENTITIES[name] ?? all),
  );

/** The text of every <tag> or <tag attr="…"> element in `xml`, trimmed and unescaped. */
const tagText = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => unescapeXml(m[1].trim()));

function checkFeedUrl(url, source) {
  const path = selfPath(url);
  if (path !== null) check(url, path, source);
  return path;
}

const read = (name) => {
  const file = join(dist, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

const rss = read('rss.xml');
if (rss !== null) for (const url of [...tagText(rss, 'link'), ...tagText(rss, 'guid')]) checkFeedUrl(url, '/rss.xml');

const sitemapIndex = read('sitemap-index.xml');
if (sitemapIndex !== null) {
  for (const url of tagText(sitemapIndex, 'loc')) {
    const path = checkFeedUrl(url, '/sitemap-index.xml');
    const file = path === null ? null : resolves(path);
    if (!file?.endsWith('.xml')) continue;
    for (const loc of tagText(readFileSync(file, 'utf8'), 'loc')) checkFeedUrl(loc, rel(file));
  }
}

// Trailing punctuation is prose, not URL; so is a closing parenthesis with no opening one.
function trimUrl(url) {
  for (;;) {
    if (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
    else if (url.endsWith(')') && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) url = url.slice(0, -1);
    else return url;
  }
}

const socialText = read('social.json');
if (socialText !== null) {
  const entries = JSON.parse(socialText);
  if (!Array.isArray(entries)) {
    console.log('social.json: expected a JSON array of entries');
    process.exit(1);
  }
  for (const entry of entries) {
    // Scheduled entries list a url whose page is not built yet (ADR 0003): skip them entirely.
    if (entry?.published !== true) continue;
    if (typeof entry.url === 'string') checkFeedUrl(entry.url, '/social.json');
    for (const key of ['linkedin', 'short']) {
      const text = entry.social?.[key];
      if (typeof text !== 'string') continue;
      for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) checkFeedUrl(trimUrl(m[0]), '/social.json');
    }
  }
}

console.log(`${pages.length} pages, ${checked} internal references checked`);
if (missing.size) {
  for (const [url, from] of missing) console.log(`MISSING ${url}  <- ${[...new Set(from)].join(', ')}`);
  process.exit(1);
}
console.log('All internal links resolve.');
