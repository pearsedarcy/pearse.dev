// The standalone-post link rule (#285, src/lib/standalone-links.ts): unit tests on fixtures, then
// the rule over every source post, drafts included. buildFeed checks approved posts only, and today
// every post is a draft, so this file is what keeps the drafts' links honest. The dist/ check covers
// only targets live at build time: a future or draft article is never in dist/.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { SITE } from '../src/lib/site.ts';
import { checkStandaloneLinks, selfOriginUrls } from '../src/lib/standalone-links.ts';
import { projects } from './lib/projects.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

// Fixtures: invented slugs only.
const ARTICLES = [
  { id: 'live-early', draft: false, pubDate: new Date('2026-11-01T00:00:00Z') },
  { id: 'same-day', draft: false, pubDate: new Date('2026-11-10T00:00:00Z') },
  { id: 'day-after', draft: false, pubDate: new Date('2026-11-11T00:00:00Z') },
  { id: 'drafted', draft: true, pubDate: new Date('2026-10-01T00:00:00Z') },
];
const CASES = [
  { id: 'fixture', category: 'mts' },
  { id: 'small', category: 'personal', smallerBuild: true },
  { id: 'waiting', category: 'client', clientPermission: 'pending' },
  { id: 'granted', category: 'client', clientPermission: 'granted' },
];
const DATE = new Date('2026-11-10T00:00:00Z');
const COPY = 'A secret sentence of copy.';
const check = (short, body = 'Body copy.') => checkStandaloneLinks({ id: 'p99', date: DATE, short, body }, ARTICLES, CASES);
const ok = (short, body) => {
  const r = check(short, body);
  assert.deepEqual(r.problems, [], short);
  return r;
};
const bad = (short, re, body) => {
  const r = check(short, body);
  assert.equal(r.url, null, short);
  assert.ok(r.problems.length > 0, `${short}: no problem`);
  if (re) assert.match(r.problems.join('\n'), re, short);
  return r;
};

test('accepted: a case study, any date', () => {
  for (const slug of ['fixture', 'granted']) {
    const url = `${SITE.url}/work/${slug}/`;
    assert.equal(ok(`${COPY} ${url}`).url, url);
  }
});

test('accepted: an article live before the post date, and on the same UTC day', () => {
  for (const id of ['live-early', 'same-day']) {
    const url = `${SITE.url}/writing/${id}/`;
    assert.equal(ok(`${COPY} ${url}`).url, url);
  }
});

test('accepted: closing punctuation after a valid URL is not part of it', () => {
  const url = `${SITE.url}/work/fixture/`;
  for (const tail of ['.', ',', ')', '!', '?', '."', '”', '’.', ');']) {
    assert.equal(ok(`${COPY} ${url}${tail}`).url, url, tail);
  }
  assert.equal(ok(`${COPY} (${url}) more.`).url, url);
});

test('rejected: every URL that is not a live deep link', () => {
  const cases = [
    [SITE.url, /bare origin/],
    [`${SITE.url}/`, /bare origin/],
    [`${SITE.url}/work/`, /index page/],
    [`${SITE.url}/writing/`, /index page/],
    [`${SITE.url}/work/fixture/#section`, /fragment/],
    [`${SITE.url}/work/fixture/?ref=x`, /query/],
    [`${SITE.url}/work/fixture`, /trailing slash/],
    [SITE.url.replace('https://', 'http://') + '/work/fixture/', /deep link/],
    [SITE.url.replace('https://', 'https://www.') + '/work/fixture/', /deep link/],
    [`${new URL(SITE.url).host}/work/fixture/`, /deep link/],
    [`${SITE.url}/work/nope/`, /names no case study/],
    // A redirect stub has a page in dist/ but is not a case study input.
    [`${SITE.url}/work/opthalyze/`, /names no case study/],
    [`${SITE.url}/work/small/`, /not a case study page/],
    [`${SITE.url}/work/waiting/`, /not a case study page/],
    [`${SITE.url}/writing/nope/`, /names no article/],
    [`${SITE.url}/writing/drafted/`, /draft article/],
    [`${SITE.url}/writing/day-after/`, /goes live on 2026-11-11, after the post date 2026-11-10/],
    [`${SITE.url}/about/`, /not a \/work\/<slug>\/ or \/writing\/<id>\/ page/],
  ];
  for (const [url, re] of cases) bad(`${COPY} ${url}`, re);
});

test('the short holds exactly one self-origin URL', () => {
  bad(COPY, /short has no https:\/\/pearse\.dev deep link/);
  const url = `${SITE.url}/work/fixture/`;
  bad(`${COPY} ${url} and ${url}`, /short has 2 pearse\.dev URLs/);
  bad(`${COPY} ${url} and ${SITE.url}/writing/live-early/`, /exactly one is allowed/);
  // Any mention of the host counts as a URL.
  bad(`Mail me at me@${new URL(SITE.url).host}. ${url}`, /exactly one is allowed/);
});

test('the body may hold no self-origin URL, and every one it holds must pass', () => {
  const short = `${COPY} ${SITE.url}/work/fixture/`;
  assert.deepEqual(check(short, 'A link-free LinkedIn body.').problems, []);
  assert.deepEqual(check(short, `Read it: ${SITE.url}/writing/same-day/.`).problems, []);
  const r = check(short, `Read it: ${SITE.url}/writing/drafted/`);
  assert.equal(r.url, `${SITE.url}/work/fixture/`, 'the short is still valid');
  assert.deepEqual(r.problems, [`standalone "p99" body links ${SITE.url}/writing/drafted/: it is a draft article.`]);
});

test('a problem names the id, the field and the path, never the copy', () => {
  const r = bad(`${COPY} ${SITE.url}/work/fixture/#section`);
  const msg = r.problems.join('\n');
  assert.match(msg, /standalone "p99"/);
  assert.match(msg, /\bshort\b/);
  assert.ok(msg.includes('/work/fixture/#section'), msg);
  assert.equal(msg.includes(COPY), false, msg);
  assert.equal(check(COPY).problems.join('\n').includes(COPY), false);
});

test('selfOriginUrls lists each token once and strips surrounding punctuation', () => {
  assert.deepEqual(selfOriginUrls(`x ("${SITE.url}/work/a/"). y`), [`${SITE.url}/work/a/`]);
  assert.deepEqual(selfOriginUrls('no links here, only github.com/pearsedarcy'), []);
});

// The rule over the source content: every standalone post, drafts included.

/** Frontmatter and body of each Markdown file in `dir`. */
function sources(dir) {
  return readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => {
      const [, front, ...rest] = readFileSync(join(dir, f), 'utf8').split(/^---\s*$/m);
      return { id: f.replace(/\.mdx?$/, ''), data: parseYaml(front), body: rest.join('---') };
    });
}

const posts = sources('src/content/social').map(({ id, data, body }) => ({ id, date: new Date(data.date), short: data.short, body, status: data.status }));
const articles = sources('src/content/posts').map(({ id, data }) => ({ id, draft: data.draft ?? false, pubDate: new Date(data.pubDate) }));
const caseStudies = projects().map((p) => ({ id: p.slug, category: p.category, clientPermission: p.clientPermission, smallerBuild: p.smallerBuild }));

let feed;
before(() => {
  assert.ok(existsSync('dist/social.json'), 'dist/social.json is missing: run `npm run build` first (npm test does it in pretest)');
  feed = JSON.parse(readFileSync('dist/social.json', 'utf8'));
});

test('every standalone post in the source, drafts included, passes the link rule', () => {
  assert.ok(posts.length > 0, 'no standalone posts');
  assert.ok(posts.some((p) => p.status === 'draft'), 'drafts are checked too');
  const problems = posts.flatMap((p) => checkStandaloneLinks(p, articles, caseStudies).problems);
  assert.deepEqual(problems, []);
});

test('every target live at build time exists in dist/', () => {
  const liveArticles = new Set(feed.filter((e) => e.kind === 'article' && e.published === true).map((e) => e.id));
  let checked = 0;
  for (const p of posts) {
    const { url } = checkStandaloneLinks(p, articles, caseStudies);
    const path = url.slice(SITE.url.length);
    const [, section, id] = path.match(/^\/(work|writing)\/([^/]+)\/$/);
    if (section === 'writing' && !liveArticles.has(id)) continue; // goes live on a later rebuild
    assert.ok(existsSync(`dist${path}index.html`), `${p.id}: dist${path}index.html`);
    checked++;
  }
  assert.ok(checked > 0, 'no target was checked against dist/');
});

test('an approved standalone post in the feed carries the deep link in its short copy as url', () => {
  for (const e of feed.filter((x) => x.kind === 'standalone')) {
    assert.ok(e.url.startsWith(`${SITE.url}/`), e.id);
    assert.ok(e.social.short.includes(e.url), e.id);
  }
});
