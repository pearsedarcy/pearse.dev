// Asserts the Skatedownhills case study (#41): the WordPress -> Flask -> Django arc,
// links to public repositories only, its draft article and standalone post kept out of
// the build and the social feed, and none of the topics left out of the essay.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const PAGE = 'dist/work/skatedownhills/index.html';
const POST = 'i-was-the-event-guy';
/** The case study's <article>, without the site chrome (styles, header, footer). */
const article = () => readFileSync(PAGE, 'utf8').match(/<article[\s\S]*?<\/article>/)?.[0] ?? '';
const CASE = 'src/content/projects/skatedownhills.md';
const ESSAY = `src/content/posts/${POST}.md`;
const P17 = 'src/content/social/p17.md';

test('case study page exists and tells the WordPress -> Flask -> Django arc', () => {
  assert.ok(existsSync(PAGE), PAGE);
  const html = article();
  const at = ['WordPress', 'Flask', 'Django'].map((w) => html.indexOf(w));
  assert.ok(at.every((i) => i >= 0), `arc terms at ${at}`);
  assert.ok(at[0] < at[1] && at[1] < at[2], 'arc is in order');
});

test('case study links only the public repository and says the other is private', () => {
  const html = article();
  const repos = [...new Set(html.match(/https:\/\/github\.com\/pearsedarcy\/[\w.-]+/g) ?? [])];
  assert.deepEqual(repos, ['https://github.com/pearsedarcy/skatehills-flask']);
  assert.equal(html.includes('downhill-skateboarding-events'), false);
  assert.match(html, /repository is private/);
});

test('the draft article has no page and is in neither the social feed, RSS nor sitemap', () => {
  assert.equal(existsSync(`dist/writing/${POST}`), false);
  const feed = JSON.parse(readFileSync('dist/social.json', 'utf8'));
  assert.equal(feed.some((e) => e.id === POST || e.id === 'p17'), false);
  assert.equal(readFileSync('dist/rss.xml', 'utf8').includes(POST), false);
  assert.equal(readFileSync('dist/sitemap-0.xml', 'utf8').includes(POST), false);
});

test('the draft article and standalone post carry social copy and stay drafts', () => {
  const post = readFileSync(ESSAY, 'utf8');
  assert.match(post, /^draft: true$/m);
  assert.match(post, /^ {2}linkedin: \|$/m);
  assert.match(post, /^ {2}short: ".+"$/m);
  assert.match(readFileSync(P17, 'utf8'), /^status: draft$/m);
});

// p17 links the case study while the essay is a draft (#285): a standalone post may only link a page
// that is live on its date (src/lib/standalone-links.ts). Repoint it once the essay is live by then.
test('a career standalone post introduces the skating-to-software arc and points at the case study (#43, #285)', () => {
  const src = readFileSync(P17, 'utf8');
  const [, fm, body] = src.split(/^---$/m);
  assert.match(fm, /^pillar: "Career"$/m);
  const url = 'https://pearse.dev/work/skatedownhills/';
  assert.ok(fm.match(/^short: "(.+)"$/m)?.[1].includes(url), 'short copy links the case study');
  assert.ok(body.includes(url), 'LinkedIn copy links the case study');
  assert.equal(src.includes(`/writing/${POST}/`), false, 'the draft essay is not linked');
  assert.match(body, /skateboard/i);
});

// The story is told once in the essay, once in the case study and once in p17, the one standalone
// post that retells it. Reads the sources, not dist/: drafts are never in the feed, so a check
// against dist/ would pass whatever the sources hold. Any other word for the story fails too.
test('p17 is the only standalone post that tells the skating story', () => {
  const dir = 'src/content/social';
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 0, `${dir} is empty`);
  const told = files.filter((f) => {
    const body = readFileSync(`${dir}/${f}`, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
    return /skateboard|skating|downhill/i.test(body);
  });
  assert.deepEqual(told, ['p17.md'], 'only p17 may retell the story; link the essay instead');
});

// Topics the essay leaves out (#41): income, mental health, the degree, family and partner.
const EXCLUDED = /€|\bincome\b|\bsalary\b|minimum wage|mental health|\bdegree\b|bachelor|dropped out|girlfriend|\bpartner\b|\bparents\b|\bfamily\b|butcher|call cent(re|er)/i;

test('none of the excluded topics appear in the sources or the case study page', () => {
  for (const file of [CASE, ESSAY, P17]) assert.doesNotMatch(readFileSync(file, 'utf8'), EXCLUDED, file);
  assert.doesNotMatch(article(), EXCLUDED, PAGE);
});
