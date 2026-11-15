// The one sanctioned way for a test to strip HTML, decode entities or judge a URL's host (#250).
// Hand-rolled `.replace(/<[^>]+>/g, '')`, chains of `.replace(/&amp;/g, '&')` and `.includes('host')`
// are what CodeQL flags (js/incomplete-multi-character-sanitization, js/double-escaping,
// js/incomplete-url-substring-sanitization), and they really are wrong in corner cases: a removed
// tag can leave a new one behind, a chained decode unescapes twice, and a substring match takes
// `evil-github.com` and `github.com.evil` for `github.com`.
//
//   decodeEntities(s)         one pass: each entity is decoded once, so `&amp;lt;` becomes `&lt;`
//   stripTags(html, sep)      the text of a fragment, from the parser in ./html.mjs, entities decoded once
//   textOf(html)              stripTags with whitespace collapsed and trimmed
//   parseUrl / hostOf         `new URL()`, and its hostname
//   isHost(url, host)         the URL's hostname is exactly `host`
//   isHostOrSubdomain(url, host)  ... or a subdomain of it
//   mentionsHost(text, host)  some hostname-shaped token in free text is `host` or a subdomain of it
import { parseHtml } from './html.mjs';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Attribute and text values are entity-decoded once by a browser, so decode once, in one pass. */
export function decodeEntities(s) {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) => {
    const code = dec !== undefined ? Number(dec) : hex !== undefined ? parseInt(hex, 16) : undefined;
    if (code !== undefined) return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

const NO_TEXT = new Set(['script', 'style']);

/**
 * The text of an HTML fragment. Tags come from the parser, not a pattern, so nothing a removal
 * leaves behind can turn into a tag; entities are decoded last and once. `<script>` and `<style>`
 * bodies are not text and are dropped. Every tag boundary becomes `sep` (a space by default, so
 * `<b>a</b><i>b</i>` reads `a b`; pass '' to keep inline markup flush).
 */
export function stripTags(html, sep = ' ') {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') out.push(child);
      else {
        out.push(sep);
        if (!NO_TEXT.has(child.tag)) walk(child);
        out.push(sep);
      }
    }
  };
  walk(parseHtml(html));
  return decodeEntities(out.join(''));
}

/** `stripTags` with runs of whitespace (including a non-breaking space) collapsed to one space. */
export const textOf = (html) => stripTags(html).replace(/[\s ]+/g, ' ').trim();

/** `new URL(value, base)`, or undefined when it does not parse. */
export function parseUrl(value, base) {
  try {
    return new URL(value, base);
  } catch {
    return undefined;
  }
}

/** The hostname of a URL (lower case, as `new URL()` gives it), or undefined. */
export const hostOf = (value) => parseUrl(value)?.hostname;

/** The URL parses and its hostname is exactly `host`: never a substring, prefix or suffix match. */
export const isHost = (value, host) => hostOf(value) === host.toLowerCase();

/** The URL's hostname is `host` or a subdomain of it (`gist.github.com` for `github.com`). */
export function isHostOrSubdomain(value, host) {
  const h = hostOf(value);
  const want = host.toLowerCase();
  return h !== undefined && (h === want || h.endsWith(`.${want}`));
}

const HOST_TOKEN = /[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/**
 * Free text (a built CSS or JS file, say) names `host`: some hostname-shaped token in it is `host`
 * or a subdomain of it. `evil-github.com` and `github.com.evil` are other hosts and do not count.
 */
export function mentionsHost(text, host) {
  const want = host.toLowerCase();
  return (text.match(HOST_TOKEN) ?? []).some((t) => {
    const h = t.toLowerCase();
    return h === want || h.endsWith(`.${want}`);
  });
}
