// #289: the "Updated <Month YYYY>" stamp on /cv/, its PDF and /now/. Unit tests for the pure
// helpers in src/lib/updated.ts, the built pages, and the git freshness check: cv.md's `updated`
// may not fall behind the month of cv.md's last commit (author date, in the commit's own offset).
// /now/'s built stamp is checked in tests/now.test.mjs. The dist/ tests rely on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { commitMonth, stampCheck, stampMonth, updatedLabel } from '../src/lib/updated.ts';
import { formatMonthYear } from '../src/lib/site.ts';
import { cvData } from './lib/cv.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CV_MD = 'src/content/cv/cv.md';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A frontmatter `updated` as the build sees it (z.coerce.date: UTC midnight), from its YAML value. */
function frontmatterDate(value, file) {
  const day = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
  assert.match(day, ISO_DAY, `${file}: updated must be a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  return { day, date: new Date(`${day}T00:00:00Z`) };
}

const stampHtml = ({ day, date }) => `<time datetime="${day}">Updated ${updatedLabel(date)}</time>`;

// --- pure helpers ---

test('updatedLabel is "Month YYYY" in en-GB, UTC', () => {
  assert.equal(updatedLabel(new Date('2026-10-28')), 'October 2026');
  assert.equal(updatedLabel(new Date('2026-12-01T00:00:00Z')), 'December 2026');
});

test('updatedLabel agrees with formatMonthYear, which the /now/ Open Graph card uses', () => {
  for (const d of ['2026-01-01', '2026-10-28', '2027-12-31']) assert.equal(updatedLabel(new Date(d)), formatMonthYear(new Date(d)));
});

test('commitMonth takes the month in the commit’s own offset, not UTC', () => {
  assert.equal(commitMonth('2026-11-30T23:30:00-05:00'), '2026-11');
  assert.equal(commitMonth('2026-12-01T00:30:00+01:00'), '2026-12');
  assert.throws(() => commitMonth(''), /ISO 8601/);
});

test('stampMonth rejects an invalid date', () => {
  assert.equal(stampMonth(new Date('2026-11-15')), '2026-11');
  assert.throws(() => stampMonth(new Date('nope')), /valid date/);
});

const NOW = new Date('2026-11-30T23:45:00Z');

test('stampCheck: first-of-month commit at +01:00, stamped with the new month, is ok in UTC before midnight', () => {
  assert.equal(stampCheck({ updated: new Date('2026-12-01'), lastChangeIso: '2026-12-01T00:30:00+01:00', now: NOW }), 'ok');
});

test('stampCheck: the same commit with a November stamp is stale', () => {
  assert.equal(stampCheck({ updated: new Date('2026-11-20'), lastChangeIso: '2026-12-01T00:30:00+01:00', now: NOW }), 'stale');
});

test('stampCheck: a commit already December in UTC but November in its own offset is ok with a November stamp', () => {
  assert.equal(stampCheck({ updated: new Date('2026-11-30'), lastChangeIso: '2026-11-30T23:30:00-05:00', now: NOW }), 'ok');
});

test('stampCheck: a stamp more than 14 h ahead of now is future', () => {
  assert.equal(stampCheck({ updated: new Date('2026-12-03'), lastChangeIso: '2026-11-30T23:30:00-05:00', now: NOW }), 'future');
});

test('stampCheck reads no clock: the result depends on now alone', () => {
  const args = { updated: new Date('2026-12-02'), lastChangeIso: '2026-11-01T10:00:00Z' };
  assert.equal(stampCheck({ ...args, now: new Date('2026-12-01T09:59:59Z') }), 'future');
  assert.equal(stampCheck({ ...args, now: new Date('2026-12-01T10:00:00Z') }), 'ok');
});

// --- built pages ---

test('cv.md has an updated date', () => {
  frontmatterDate(cvData().updated, CV_MD);
});

test('/cv/ shows the stamp from cv.md in its header aside, printable', () => {
  const html = readFileSync(`${ROOT}dist/cv/index.html`, 'utf8');
  const stamp = stampHtml(frontmatterDate(cvData().updated, CV_MD));
  assert.ok(html.includes(stamp), `missing ${stamp}`);
  const head = html.slice(html.indexOf('class="cv-head'), html.indexOf('</header>', html.indexOf('class="cv-head')));
  const aside = head.slice(head.indexOf('class="cv-aside'));
  assert.ok(aside.includes(stamp), 'the stamp sits in the header aside');
  const li = aside.match(/<li\b[^>]*>(?:(?!<\/li>)[\s\S])*?<time datetime=/)?.[0] ?? '';
  assert.match(li, /class="cv-updated[\s"]/);
  assert.doesNotMatch(li, /cv-screen/, 'the stamp must print');
});

// --- git freshness ---

// Git reads this checkout, never a repository that an inherited GIT_DIR or GIT_WORK_TREE names.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (args) => execFileSync('git', args, { cwd: ROOT, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Why this checkout cannot date cv.md, or undefined when it can. */
function historyProblem() {
  let shallow;
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']);
  } catch {
    return 'git is unavailable or this checkout is not a git repository';
  }
  if (shallow === 'true') return 'this checkout is shallow, so git log cannot date cv.md';
  if (shallow !== 'false') return `git rev-parse --is-shallow-repository printed ${JSON.stringify(shallow)}`;
  return undefined;
}

test('cv.md’s updated is not behind its last commit, nor in the future', (t) => {
  const problem = historyProblem();
  if (problem) {
    if (process.env.CI) assert.fail(`${problem}: set fetch-depth: 0 on the checkout step in .github/workflows/check.yml`);
    t.skip(`${problem} (set fetch-depth: 0 in CI)`);
    return;
  }
  // Author date: a rebase rewrites the committer date and would fail this after the fact.
  const lastChangeIso = git(['log', '-1', '--format=%aI', '--', CV_MD]);
  if (!lastChangeIso) {
    t.skip(`${CV_MD} has no commit yet`);
    return;
  }
  const { day, date } = frontmatterDate(cvData().updated, CV_MD);
  const state = stampCheck({ updated: date, lastChangeIso, now: new Date() });
  const stamp = stampMonth(date);
  const changed = commitMonth(lastChangeIso);
  assert.equal(
    state,
    'ok',
    state === 'stale'
      ? `${CV_MD}: updated ${day} (${stamp}) is behind its last commit (${lastChangeIso}, ${changed}); bump updated to ${changed} or later`
      : `${CV_MD}: updated ${day} (${stamp}) is in the future; last commit ${lastChangeIso} (${changed})`,
  );
});
