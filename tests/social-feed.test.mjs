// Asserts the shape, ordering and draft exclusion of /social.json for both kinds
// (articles and standalone posts), and that the standalone migration is idempotent.
// Builds only if dist/social.json is missing, so it reads the build CI just made.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

let feed;

before(() => {
  if (!existsSync('dist/social.json')) execSync('npm run build', { cwd: ROOT, stdio: 'pipe', timeout: 120_000 });
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
    assert.ok(e.url.startsWith('https://pearse.dev/writing/'), e.url);
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
    assert.match(p01, /^short: "First line \[VERIFY: is this right\? yes\.\] ends here\. https:\/\/pearse\.dev"$/m);
    assert.ok(p01.endsWith('\n---\n\nFirst line [VERIFY: is this right? yes.] ends here. Second sentence.\n\nMore.\n'));
    assert.match(first['p02.md'], /^visual: "none"$/m);
    assert.doesNotMatch(first['p02.md'], /^note:/m);
    assert.deepEqual(run(), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
