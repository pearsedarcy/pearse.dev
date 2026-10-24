// Asserts the shape, ordering and draft exclusion of /social.json for both kinds
// (articles and standalone posts), the pure buildFeed rules on fixtures, and that the
// standalone migration is idempotent. Reads the build made by `pretest`.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/lib/site.ts';
import { buildFeed } from '../src/lib/feed.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

let feed;

before(() => {
  assert.ok(existsSync('dist/social.json'), 'dist/social.json is missing: run `npm run build` first (npm test does it in pretest)');
  feed = JSON.parse(readFileSync('dist/social.json', 'utf8'));
});

/** Source ids whose frontmatter matches `re`. */
function sourceIds(dir, re) {
  return readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f) && re.test(readFileSync(join(dir, f), 'utf8').split(/^---$/m)[1] ?? ''))
    .map((f) => f.replace(/\.mdx?$/, ''));
}

test('feed is a JSON array of well-formed entries', () => {
  assert.ok(Array.isArray(feed));
  for (const e of feed) {
    assert.ok(['article', 'standalone'].includes(e.kind), `kind ${e.kind}`);
    assert.equal(typeof e.id, 'string');
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.id);
    assert.equal(typeof e.status, 'string', e.id);
    assert.equal(typeof e.published, 'boolean', e.id);
    assert.ok(e.social?.linkedin?.length > 0, `${e.id} linkedin`);
    assert.ok(e.social?.short?.length > 0, `${e.id} short`);
  }
});

test('feed is sorted by date ascending', () => {
  const dates = feed.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('no draft entries of either kind', () => {
  assert.equal(feed.some((e) => e.status === 'draft'), false);
  const ids = new Set(feed.map((e) => `${e.kind}:${e.id}`));
  for (const id of sourceIds('src/content/posts', /^draft:\s*true\s*$/m)) assert.equal(ids.has(`article:${id}`), false, id);
  for (const id of sourceIds('src/content/social', /^status:\s*draft\s*$/m)) assert.equal(ids.has(`standalone:${id}`), false, id);
  // Approved standalone posts are all present, future-dated or not.
  for (const id of sourceIds('src/content/social', /^status:\s*approved\s*$/m)) assert.ok(ids.has(`standalone:${id}`), id);
});

test('article entries keep the legacy fields and link to their page', () => {
  const articles = feed.filter((e) => e.kind === 'article');
  assert.ok(articles.length >= 1);
  for (const e of articles) {
    assert.ok(e.url.startsWith(`${SITE.url}/writing/`), e.url);
    assert.equal(e.slug, e.id);
    assert.equal(e.pubDate, e.date);
    assert.ok(Array.isArray(e.tags));
  }
});

test('standalone entries are always published and never carry a url', () => {
  for (const e of feed.filter((x) => x.kind === 'standalone')) {
    assert.equal(e.published, true, e.id);
    assert.equal('url' in e, false, e.id);
  }
});

test('migrate-standalone writes one file per post, preserves markers, and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
  try {
    const input = join(dir, 'in.json');
    const out = join(dir, 'social');
    writeFileSync(
      input,
      JSON.stringify({
        posts: [
          {
            id: 'P01',
            title: 'A "quoted" title',
            pillar: 'Agentic engineering',
            format: 'Short lesson',
            date: '2026-11-04',
            visual: 'none',
            status: 'approved',
            linkedin: 'First line [VERIFY: is this right? yes.] ends here. Second sentence.\n\nMore.',
            note: 'client post',
          },
          { id: 'P02', title: 'Two', pillar: 'Platform building (Django)', format: 'X', date: '2026-11-05', status: 'draft', linkedin: 'Only.' },
        ],
      }),
    );
    const run = () => {
      const r = spawnSync(process.execPath, ['scripts/migrate-standalone.mjs', input, out], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return Object.fromEntries(readdirSync(out).sort().map((f) => [f, readFileSync(join(out, f), 'utf8')]));
    };
    const first = run();
    assert.deepEqual(Object.keys(first), ['p01.md', 'p02.md']);
    const p01 = first['p01.md'];
    assert.match(p01, /^title: "A \\"quoted\\" title"$/m);
    assert.match(p01, /^date: 2026-11-04$/m);
    assert.match(p01, /^status: approved$/m);
    assert.match(p01, /^note: "client post"$/m);
    assert.ok(p01.includes(`\nshort: "First line [VERIFY: is this right? yes.] ends here. ${SITE.url}"\n`));
    assert.ok(p01.endsWith('\n---\n\nFirst line [VERIFY: is this right? yes.] ends here. Second sentence.\n\nMore.\n'));
    assert.match(first['p02.md'], /^visual: "none"$/m);
    assert.doesNotMatch(first['p02.md'], /^note:/m);
    assert.deepEqual(run(), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// buildFeed: the merge, filter and sort rules on plain fixtures, independent of today's content.
const NOW = new Date('2026-11-10T12:00:00Z');
const copy = { linkedin: ' L ', short: ' S ' };
const article = (id, pubDate, draft = false) => ({ id, title: id, pubDate: new Date(pubDate), draft, tags: ['t'], url: `${SITE.url}/writing/${id}/`, social: copy });
const standalone = (id, date, status = 'approved', body = 'Copy.') => ({
  id, title: id, date: new Date(date), pillar: 'Agentic engineering', format: 'Short lesson', visual: 'none', status, short: 'S', body,
});

test('buildFeed: drafts of both kinds are excluded, the rest sorted ascending across kinds, articles win ties', () => {
  const out = buildFeed(
    [article('future', '2026-12-01'), article('tie', '2026-11-05'), article('draft-a', '2026-11-01', true), article('past', '2026-10-01')],
    [standalone('s-tie', '2026-11-05'), standalone('s-draft', '2026-11-02', 'draft'), standalone('s-early', '2026-10-15')],
    NOW,
  );
  assert.deepEqual(out.map((e) => `${e.kind}:${e.id}`), ['article:past', 'standalone:s-early', 'article:tie', 'standalone:s-tie', 'article:future']);
  assert.ok(out.every((e) => e.status === 'approved'));
});

test('buildFeed: a future-dated article is in the feed as scheduled', () => {
  const [e] = buildFeed([article('future', '2026-12-01')], [], NOW);
  assert.equal(e.published, false);
  assert.equal(e.status, 'approved');
  assert.equal(e.date, '2026-12-01');
  assert.equal(e.pubDate, '2026-12-01');
  assert.equal(e.slug, 'future');
  assert.deepEqual(e.social, { linkedin: 'L', short: 'S' });
});

test('buildFeed: a future-dated approved standalone post is published and has no url', () => {
  const [e] = buildFeed([], [standalone('s-future', '2027-01-01', 'approved', '\nBody copy.\n')], NOW);
  assert.equal(e.kind, 'standalone');
  assert.equal(e.published, true);
  assert.equal('url' in e, false);
  assert.equal(e.social.linkedin, 'Body copy.');
});

test('buildFeed: an approved standalone post with a verify marker in its body throws', () => {
  assert.throws(() => buildFeed([], [standalone('s-bad', '2026-11-20', 'approved', 'Copy [VERIFY: check].')], NOW), /s-bad.*\[VERIFY\]/);
  // The same body on a draft is fine: drafts are never in the feed.
  assert.deepEqual(buildFeed([], [standalone('s-bad', '2026-11-20', 'draft', 'Copy [VERIFY: check].')], NOW), []);
});
