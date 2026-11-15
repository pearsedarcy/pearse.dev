// The standalone-post link rule (#285): a standalone post's `short` holds exactly one self-origin
// URL, a deep link to a case study or to an article that is live on the post's date; its LinkedIn
// body may hold none, but every one it holds follows the same rule. Pure, with no `astro:content`
// import, so buildFeed (src/lib/feed.ts), tests/standalone-links.test.mjs and any script share it.
// The origin is `SITE.url` (src/lib/site.ts), written out once in origin.mjs. Imported from there, not
// site.ts, so `npm run check` can type-check select.mjs (no DOM lib) through feed.ts.
import { ORIGIN } from './origin.mjs';
import { isCaseStudy } from './visibility.ts';

/** An article as the rule needs it: its id (the /writing/<id>/ path), draft flag and pubDate. */
export interface LinkArticle {
  id: string;
  draft: boolean;
  pubDate: Date;
}

/** A case study as the rule needs it: its slug as `id` and the isCaseStudy fields. */
export interface LinkCaseStudy {
  id: string;
  category: string;
  clientPermission?: string;
  smallerBuild?: boolean;
}

/** A standalone post as the rule needs it. */
export interface LinkPost {
  id: string;
  /** The day it goes out (UTC). */
  date: Date;
  short: string;
  /** Markdown body: the LinkedIn copy. */
  body: string;
}

export interface StandaloneLinks {
  /** The validated absolute deep link in `short`, or null when `short` has any problem. */
  url: string | null;
  /** One line per problem, naming the post id, the field and the offending URL; never the copy. */
  problems: string[];
}

const HOST = ORIGIN.replace(/^[a-z]+:\/\//, '');
const HOST_RE = new RegExp(HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
// The scheduler's URL_END boundary (automation/n8n/select.mjs): closing punctuation after a URL.
const CLOSING = /[.,;:!?)\]}>'"’”…]+$/;
const OPENING = /^[(\[{<'"‘“]+/;

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Every self-origin URL in `text`: each whitespace-delimited token that contains the site's host
 * (any case, any scheme or none), with opening punctuation before it and closing punctuation
 * after it stripped. A token is listed once however many times the host occurs in it.
 */
export function selfOriginUrls(text: string): string[] {
  const urls: string[] = [];
  let end = -1;
  for (const m of text.matchAll(HOST_RE)) {
    const i = m.index ?? 0;
    if (i < end) continue;
    let start = i;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    end = i;
    while (end < text.length && !/\s/.test(text[end])) end++;
    urls.push(text.slice(start, end).replace(OPENING, '').replace(CLOSING, ''));
  }
  return urls;
}

/** Why `url` is not a deep link live on `date`, or null when it is one. */
function whyNot(url: string, date: Date, articles: readonly LinkArticle[], caseStudies: readonly LinkCaseStudy[]): string | null {
  if (url === ORIGIN || url === `${ORIGIN}/`) return 'is the bare origin; link a case study or an article';
  if (!url.startsWith(`${ORIGIN}/`)) return `is not a ${ORIGIN}/ deep link`;
  const path = url.slice(ORIGIN.length);
  if (path.includes('#')) return 'has a fragment; link the page itself';
  if (path.includes('?')) return 'has a query string';
  if (/^\/(work|writing)\/$/.test(path)) return 'is an index page, not a case study or an article';
  if (/^\/(work|writing)\/[^/]+$/.test(path)) return 'has no trailing slash';
  const m = path.match(/^\/(work|writing)\/([^/]+)\/$/);
  if (!m) return 'is not a /work/<slug>/ or /writing/<id>/ page';
  const [, section, id] = m;
  if (section === 'work') {
    const c = caseStudies.find((x) => x.id === id);
    if (!c) return 'names no case study (a redirect stub or a pending client case study is not one)';
    if (!isCaseStudy(c)) return 'is not a case study page (a smaller build or a pending client case study)';
    return null;
  }
  const a = articles.find((x) => x.id === id);
  if (!a) return 'names no article';
  if (a.draft) return 'is a draft article';
  if (day(a.pubDate) > day(date)) return `is an article that goes live on ${day(a.pubDate)}, after the post date ${day(date)}`;
  return null;
}

/**
 * The link rule for one standalone post. `short` must hold exactly one self-origin URL, and it must
 * be `<origin>/work/<slug>/` for a case study (isCaseStudy, live on any date) or
 * `<origin>/writing/<id>/` for an article with `draft: false` and a pubDate (UTC day) on or before
 * the post's date. Every self-origin URL in `body` must pass the same check; the body may hold none.
 * Rejected: the bare origin, index pages, fragments, queries, a missing trailing slash, `http://`,
 * `www.`, an unknown slug, a smaller build, a draft or later article.
 */
export function checkStandaloneLinks(
  post: LinkPost,
  articles: readonly LinkArticle[],
  caseStudies: readonly LinkCaseStudy[],
): StandaloneLinks {
  const problems: string[] = [];
  const check = (field: 'short' | 'body', url: string) => {
    const why = whyNot(url, post.date, articles, caseStudies);
    if (why) problems.push(`standalone "${post.id}" ${field} links ${url}: it ${why}.`);
    return !why;
  };
  const inShort = selfOriginUrls(post.short);
  if (inShort.length === 0) {
    problems.push(`standalone "${post.id}" short has no ${ORIGIN} deep link; end it with a case study or article URL.`);
  } else if (inShort.length > 1) {
    problems.push(`standalone "${post.id}" short has ${inShort.length} ${HOST} URLs (${inShort.join(', ')}); exactly one is allowed.`);
  }
  const shortOk = inShort.map((u) => check('short', u)).every(Boolean);
  for (const u of selfOriginUrls(post.body)) check('body', u);
  return { url: inShort.length === 1 && shortOk ? inShort[0] : null, problems };
}
