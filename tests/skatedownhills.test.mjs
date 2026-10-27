// Asserts the Skatedownhills case study (#41): the WordPress -> Flask -> Django arc,
// links to public repositories only, its draft article and standalone post kept out of
// the build and the social feed, and none of the topics left out of the essay.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const PAGE = 'dist/work/skatedownhills/index.html';
const POST = 'i-was-the-event-guy';
/** The case study's <article>, without the site chrome (styles, header, footer). */
const article = () => readFileSync(PAGE, 'utf8').match(/<article[\s\S]*?<\/article>/)?.[0] ?? '';
const SOURCES = ['src/content/projects/skatedownhills.md', `src/content/posts/${POST}.md`, 'src/content/social/p16.md'];

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
  assert.equal(feed.some((e) => e.id === POST || e.id === 'p16'), false);
  assert.equal(readFileSync('dist/rss.xml', 'utf8').includes(POST), false);
  assert.equal(readFileSync('dist/sitemap-0.xml', 'utf8').includes(POST), false);
});

test('the draft article and standalone post carry social copy and stay drafts', () => {
  const post = readFileSync(SOURCES[1], 'utf8');
  assert.match(post, /^draft: true$/m);
  assert.match(post, /^ {2}linkedin: \|$/m);
  assert.match(post, /^ {2}short: ".+"$/m);
  assert.match(readFileSync(SOURCES[2], 'utf8'), /^status: draft$/m);
});

// Topics the essay leaves out (#41): income, mental health, the degree, family and partner.
const EXCLUDED = /€|\bincome\b|\bsalary\b|minimum wage|mental health|\bdegree\b|bachelor|dropped out|girlfriend|\bpartner\b|\bparents\b|\bfamily\b|butcher|call cent(re|er)/i;

test('none of the excluded topics appear in the sources or the case study page', () => {
  for (const file of SOURCES) assert.doesNotMatch(readFileSync(file, 'utf8'), EXCLUDED, file);
  assert.doesNotMatch(article(), EXCLUDED, PAGE);
});
