// The one origin walker for the dist/ tests (#115, #129). The footer says "Static HTML, no
// tracking", so a visit must not send the visitor's IP anywhere but pearse.dev, with one exception
// that exists only while `SITE.analyticsToken` is set: Cloudflare's beacon host.
//
// `resourceUrls(html)` lists every URL a browser fetches without a click, from a fixed list of
// attributes and CSS forms (see below). `allowedOrigins(token)` is the allowlist. `<a href>` is
// deliberately not scanned (outbound links are fine) and neither is `xmlns` (a namespace, not a
// fetch). Limitation: fetches started by JavaScript in the bundled _astro/*.js are not scanned, so
// this keeps "no third-party scripts, fonts or embeds" true for markup and CSS only.
import { ORIGIN } from '../../src/lib/origin.mjs';
import { find, parseHtml, srcsetCandidates, text } from './html.mjs';
import { decodeEntities } from './sanitise.mjs';

export const BEACON_ORIGIN = 'https://static.cloudflareinsights.com';

/** The origins a built page may load from: this site, plus the beacon host only for a non-empty token. */
export function allowedOrigins(token) {
  return typeof token === 'string' && token !== '' ? [ORIGIN, BEACON_ORIGIN] : [ORIGIN];
}

const SRC_TAGS = new Set(['script', 'img', 'iframe', 'source', 'video', 'audio', 'embed']);
const SVG_HREF_TAGS = new Set(['image', 'use']);
const LOADING_RELS = new Set(['stylesheet', 'icon', 'apple-touch-icon', 'preload', 'modulepreload', 'prefetch', 'manifest']);

/** `url(...)` and `@import "..."` targets in a piece of CSS. */
function cssUrls(css, where, out) {
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    out.push({ where, url: m[1] ?? m[2] ?? m[3] });
  }
  for (const m of css.matchAll(/@import\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    out.push({ where, url: m[1] ?? m[2] });
  }
}

/**
 * Every URL a page fetches without a click, as { where, url } with entities decoded. Runs over the
 * raw markup, so `<noscript>` content is included; `<script>` bodies are raw text and never read.
 */
export function resourceUrls(html) {
  const out = [];
  for (const el of find(parseHtml(html), () => true)) {
    const attrs = Object.fromEntries(Object.entries(el.attrs).map(([k, v]) => [k, decodeEntities(v)]));
    const add = (name) => out.push({ where: `<${el.tag} ${name}>`, url: attrs[name] });
    if (attrs.src !== undefined && (SRC_TAGS.has(el.tag) || (el.tag === 'input' && (attrs.type ?? '').toLowerCase() === 'image'))) add('src');
    if (attrs.srcset !== undefined && (el.tag === 'img' || el.tag === 'source')) {
      for (const c of srcsetCandidates(attrs.srcset)) out.push({ where: `<${el.tag} srcset>`, url: c.url });
    }
    if (attrs.poster !== undefined && el.tag === 'video') add('poster');
    if (attrs.data !== undefined && el.tag === 'object') add('data');
    if (SVG_HREF_TAGS.has(el.tag)) {
      if (attrs.href !== undefined) add('href');
      if (attrs['xlink:href'] !== undefined) add('xlink:href');
    }
    if (el.tag === 'link' && attrs.href !== undefined) {
      const rels = (attrs.rel ?? '').toLowerCase().split(/\s+/);
      if (rels.some((r) => LOADING_RELS.has(r))) out.push({ where: `<link rel=${attrs.rel}>`, url: attrs.href });
    }
    if (attrs.style !== undefined) cssUrls(attrs.style, `<${el.tag} style>`, out);
    if (el.tag === 'style') cssUrls(text(el), '<style>', out);
  }
  return out;
}

/**
 * The origin a URL would be fetched from, or undefined when it is same-origin: relative, fragment
 * only, `data:` (inline, makes no request) or this site's own origin. Anything unparseable or on an
 * opaque scheme (`blob:`, `javascript:`) reports its scheme so it can never pass.
 */
export function foreignOrigin(url) {
  const u = url.trim();
  if (u === '' || /^data:/i.test(u)) return undefined;
  let parsed;
  try {
    parsed = new URL(u, ORIGIN);
  } catch {
    return `unparseable:${u.slice(0, 40)}`;
  }
  return parsed.origin === ORIGIN ? undefined : parsed.origin;
}

/** The resource URLs of `html` whose origin is not in `allowed`, as { where, url, origin }. */
export function offenders(html, allowed) {
  return resourceUrls(html).flatMap(({ where, url }) => {
    const origin = foreignOrigin(url);
    return origin === undefined || allowed.includes(origin) ? [] : [{ where, url, origin }];
  });
}
