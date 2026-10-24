#!/usr/bin/env node
/**
 * Crawl dist/ and verify every internal href/src resolves to a built file.
 * Usage: node scripts/check-links.mjs [dist]
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

function resolves(url) {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean) return true; // pure fragment
  const candidates = [
    join(dist, clean),
    join(dist, clean, 'index.html'),
    join(dist, `${clean}.html`),
    join(dist, clean.replace(/\/$/, '') + '.html'),
  ];
  return candidates.some((c) => existsSync(c) && statSync(c).isFile());
}

const pages = walk(dist);
const attr = /\b(?:href|src)=["']([^"']+)["']/g;
const missing = new Map();
let checked = 0;

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(attr)) {
    const url = m[1];
    if (!url.startsWith('/') || url.startsWith('//')) continue;
    checked++;
    if (!resolves(url)) {
      const list = missing.get(url) ?? [];
      list.push(page.replace(dist, ''));
      missing.set(url, list);
    }
  }
}

console.log(`${pages.length} pages, ${checked} internal references checked`);
if (missing.size) {
  for (const [url, from] of missing) console.log(`MISSING ${url}  <- ${[...new Set(from)].join(', ')}`);
  process.exit(1);
}
console.log('All internal links resolve.');
