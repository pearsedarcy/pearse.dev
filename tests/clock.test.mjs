// Issue #283: the build clock (src/lib/clock.ts, GLOSSARY "Build clock"). Unit cases for
// siteNow(), wallNow() and the build-log notice; a source scan that bans every other clock read
// in the publishing code; a rule that no workflow sets SITE_NOW (a deploy built ahead would
// publish early); and a check that dist/ was built at the same clock this run asserts against, so
// `SITE_NOW=<date> npm test` builds and checks as of that date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClockNotice, siteNow, siteNowOverride, wallNow } from '../src/lib/clock.ts';
import { posts } from './lib/posts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Runs `fn` with SITE_NOW set to `value` (`undefined` deletes it), then restores the outer value. */
function withSiteNow(value, fn) {
  const outer = process.env.SITE_NOW;
  if (value === undefined) delete process.env.SITE_NOW;
  else process.env.SITE_NOW = value;
  try {
    return fn();
  } finally {
    if (outer === undefined) delete process.env.SITE_NOW;
    else process.env.SITE_NOW = outer;
  }
}

// ---- siteNow, wallNow, buildClockNotice ---------------------------------------------------------

test('siteNow: unset or empty SITE_NOW is the real clock', () => {
  for (const value of [undefined, '']) {
    withSiteNow(value, () => {
      assert.ok(Math.abs(siteNow().getTime() - Date.now()) < 1000, `SITE_NOW=${JSON.stringify(value)}`);
      assert.equal(siteNowOverride(), undefined);
      assert.equal(buildClockNotice(), undefined, 'no build clock line');
    });
  }
});

test('siteNow: YYYY-MM-DD is UTC midnight of that day', () => {
  withSiteNow('2026-12-01', () => assert.equal(siteNow().toISOString(), '2026-12-01T00:00:00.000Z'));
});

test('siteNow: a full ISO timestamp is that instant', () => {
  withSiteNow('2026-12-01T10:30:00Z', () => assert.equal(siteNow().toISOString(), '2026-12-01T10:30:00.000Z'));
  withSiteNow('2026-12-01T10:30:00.250+01:00', () => assert.equal(siteNow().toISOString(), '2026-12-01T09:30:00.250Z'));
});

test('siteNow: anything else throws an error naming SITE_NOW', () => {
  // A timestamp without a zone would be read in the local time zone, and 2026-02-31 would roll
  // over into March, so both are refused rather than guessed.
  for (const value of ['tomorrow', '2026', '2026-13-01', '2026-02-31', '2026-12-01T10:30', ' 2026-12-01', '01/12/2026']) {
    withSiteNow(value, () => {
      assert.throws(() => siteNow(), /SITE_NOW/, value);
      assert.throws(() => buildClockNotice(), /SITE_NOW/, value);
    });
  }
});

test('siteNow: SITE_NOW is read on every call, not cached', () => {
  withSiteNow('2026-12-01', () => assert.equal(siteNow().toISOString(), '2026-12-01T00:00:00.000Z'));
  withSiteNow('2027-01-15', () => assert.equal(siteNow().toISOString(), '2027-01-15T00:00:00.000Z'));
});

test('wallNow: the real clock, whatever SITE_NOW says', () => {
  withSiteNow('2030-06-01', () => assert.ok(Math.abs(wallNow().getTime() - Date.now()) < 1000));
});

test('buildClockNotice: one line naming SITE_NOW and the instant, marked not for deploy', () => {
  withSiteNow('2026-12-01', () => assert.equal(buildClockNotice(), 'build clock: SITE_NOW=2026-12-01T00:00:00.000Z (not for deploy)'));
});

test('og:pages: an invalid SITE_NOW fails before any card is rendered, naming SITE_NOW', () => {
  // Exits before public/og/ is emptied, so this leaves the built cards alone.
  const r = spawnSync(process.execPath, ['scripts/og-pages.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SITE_NOW: 'nonsense' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^og:pages: SITE_NOW="nonsense" is not a date/m);
  assert.doesNotMatch(r.stdout, /build clock:/);
});

// ---- the source scan -----------------------------------------------------------------------------

// A zero-argument `new Date()` or `Date()`, or any `Date.now(`. `new Date(x)` and `Date.UTC(` pass.
const CLOCK_READ = /(?<![\w.$])(?:new\s+)?Date\(\s*\)|\bDate\.now\(/g;

/** `src` with `/* ... *\/` and `//`-to-end-of-line comments blanked, line breaks kept. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
}

/** The 1-based line of every clock read in `src`. A regex scan, not an AST: strings are not exempt. */
function clockReads(src) {
  const code = stripComments(src);
  return [...code.matchAll(CLOCK_READ)].map((m) => code.slice(0, m.index).split('\n').length);
}

/** Every `.ts`, `.mjs` and `.astro` file under `dir`, recursively. */
function sources(dir) {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|mjs|astro)$/.test(e.name))
    .map((e) => relative(ROOT, join(e.parentPath, e.name)));
}

const EXEMPT = 'src/lib/clock.ts';
// scripts/og-cards.mjs holds the og:pages card selection (#278), so it is scanned with og-pages.
const SCRIPTS = ['scripts/og-pages.mjs', 'scripts/og-cards.mjs', 'scripts/runway.mjs', 'scripts/content-entries.mjs'];
const SCOPE = [...sources('src'), ...SCRIPTS, ...sources('tests/lib').filter((f) => f.endsWith('.mjs'))].filter((f) => f !== EXEMPT);

test('the scanner flags new Date(), Date() and Date.now(), and passes new Date(x) and comments', () => {
  assert.deepEqual(clockReads('const a = new Date();'), [1]);
  assert.deepEqual(clockReads('x;\nconst a = Date();'), [2]);
  assert.deepEqual(clockReads('x;\ny;\nconst t = Date.now() - 1;'), [3]);
  assert.deepEqual(clockReads('const b = new Date(\n);'), [1], 'empty arguments across a line break');
  assert.deepEqual(clockReads('function f(now = new Date()) {}'), [1], 'a default parameter');
  assert.deepEqual(clockReads('const a = new Date(x);\nconst b = new Date(String(v));\nconst c = Date.UTC(2026, 0, 1);'), []);
  assert.deepEqual(clockReads('// const a = new Date();\nconst b = 1; // Date.now()\n/* new Date()\n Date() */\nconst c = performance.now();'), []);
  assert.deepEqual(clockReads('/* a\n b */\nconst a = new Date();'), [3], 'a block comment keeps line numbers');
  assert.deepEqual(clockReads('const a = isDate(); const b = x.Date(); const c = $Date();'), [], 'other identifiers');
});

test('the scan scope covers the publishing code', () => {
  for (const f of ['src/lib/posts.ts', 'src/lib/visibility.ts', 'src/lib/feed.ts', 'src/pages/writing/[slug].astro', 'src/components/Footer.astro', 'tests/lib/posts.mjs', ...SCRIPTS]) {
    assert.ok(SCOPE.includes(f), f);
  }
  assert.ok(!SCOPE.includes(EXEMPT));
  assert.ok(SCOPE.length > 50, `${SCOPE.length} files`);
});

test('no clock read outside src/lib/clock.ts: publishing decisions use siteNow(), build facts wallNow()', () => {
  const found = [];
  for (const file of SCOPE) for (const line of clockReads(readFileSync(join(ROOT, file), 'utf8'))) found.push(`${file}:${line}`);
  assert.deepEqual(found, [], `read the time through src/lib/clock.ts instead:\n${found.join('\n')}`);
});

// ---- workflows -----------------------------------------------------------------------------------

test('no workflow sets or mentions SITE_NOW: a deploy is never built ahead', () => {
  const dir = join(ROOT, '.github/workflows');
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  assert.ok(files.length > 0, 'workflows to check');
  for (const e of files) {
    const file = relative(ROOT, join(e.parentPath, e.name));
    assert.equal(readFileSync(join(ROOT, file), 'utf8').includes('SITE_NOW'), false, `${file} mentions SITE_NOW`);
  }
});

// ---- dist/ was built at this clock ---------------------------------------------------------------

test('dist/ has an article page for exactly the articles published at the build clock', () => {
  const all = posts(siteNow());
  const published = all.filter((p) => p.published).map((p) => p.id).sort();
  const built = all.filter((p) => existsSync(join(ROOT, 'dist/writing', p.id, 'index.html'))).map((p) => p.id).sort();
  assert.ok(published.length > 0, 'published articles');
  assert.deepEqual(built, published);
  const rss = readFileSync(join(ROOT, 'dist/rss.xml'), 'utf8');
  for (const p of all) assert.equal(rss.includes(`/writing/${p.id}/`), p.published, `rss.xml and ${p.id}`);
});

test('the footer year is the build clock year', () => {
  const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
  assert.match(html, new RegExp(`© ${siteNow().getFullYear()} `));
});
