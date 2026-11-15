/**
 * Browser harness shared by the smoke run (smoke.mjs) and the accessibility scan (a11y.mjs):
 * sitemap URL discovery, the one Chrome lookup and launch, and the external-request stub.
 * The static server stays in server.mjs. Nothing here is specific to one check.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chromium } from 'playwright-core';
import { findChrome } from '../og-shared.mjs';
import { decodeEntities } from '../../tests/lib/sanitise.mjs';

/** Chrome flags: no sandbox (CI runs as a trusted user) and software WebGL (the runner has no GPU). */
export const CHROME_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** 1x1 transparent PNG, served for every external image (the GitHub avatar). */
export const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** Print `message` to stderr and exit 2: a usage or environment problem, not a check failure. */
export function die(message) {
  console.error(message);
  process.exit(2);
}

export const decode = decodeEntities;

/**
 * Every `<loc>` path (with query) in `<dist>/sitemap-0.xml`. The origin is dropped so the local
 * server can stand in. `who` prefixes the error ("smoke", "a11y").
 */
export function sitemapPaths(dist, who) {
  let xml;
  try {
    xml = readFileSync(join(dist, 'sitemap-0.xml'), 'utf8');
  } catch {
    die(`${who}: no ${relative(process.cwd(), join(dist, 'sitemap-0.xml'))}. Run npm run build first.`);
  }
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
    const u = new URL(decode(m[1].trim()));
    return u.pathname + u.search;
  });
}

/** The Chrome binary from findChrome() (CHROME_PATH, then PATH), or exit 2 asking for CHROME_PATH. */
export function requireChrome(who) {
  const chrome = findChrome();
  if (!chrome) die(`${who}: no Chrome found on PATH (google-chrome, chromium, chromium-browser). Set CHROME_PATH to a Chrome or Chromium binary.`);
  return chrome;
}

/**
 * Headless Chrome hides scrollbars (Playwright passes `--hide-scrollbars`). `scrollbars: true` keeps
 * them, so a tall page gets the 15 px classic bar of desktop Chrome on Linux and Windows (#359).
 */
export const launchBrowser = (executablePath, { scrollbars = false } = {}) =>
  chromium.launch({ executablePath, args: CHROME_ARGS, ...(scrollbars && { ignoreDefaultArgs: ['--hide-scrollbars'] }) });

/** Let same-origin requests through; external images get a 1x1 PNG, everything else is aborted. */
export function stubExternal(context, origin) {
  const local = (url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  return context.route('**/*', (route) => {
    const req = route.request();
    if (local(req.url())) return route.continue();
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
    return route.abort('blockedbyclient');
  });
}
