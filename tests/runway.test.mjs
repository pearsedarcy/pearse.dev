// Issue #128: the publishing runway report. The pure buildRunway (src/lib/runway.ts) on invented
// fixtures with a fixed `now`, then scripts/runway.mjs on the real content: exit 0, the summary
// appended, the warning-line shape, and that nothing but ids, kinds, states, dates and counts
// leaves it. Reads the sources, not dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildRunway, formatRunway, warningLine } from '../src/lib/runway.ts';
import { entries } from '../scripts/content-entries.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const NOW = new Date('2026-11-01T12:00:00Z'); // a Sunday: the ISO week starts 2026-10-26
const MARKED = 'Text [VERIFY: check this] more.';

const article = (id, pubDate, draft = false, extra = {}, body = 'Clean body.') => ({
  id,
  data: { title: 'A title', description: 'A description', pubDate, draft, social: { linkedin: 'Copy.', short: 'Short.' }, ...extra },
  body,
});
const standalone = (id, date, status = 'draft', extra = {}, body = 'Clean copy.') => ({
  id,
  data: { title: 'A title', date, pillar: 'Agentic engineering', format: 'Short lesson', visual: 'none', status, short: 'Short.', ...extra },
  body,
});
const project = (id, extra = {}) => ({
  id,
  data: { slug: id, title: 'A title', category: 'tool', ...extra },
  body: 'Clean body.',
});
const social = (date) => ({ social: { date, linkedin: 'Copy.', short: 'Short.' } });

const stateOf = (r, id) => r.rows.find((row) => row.id === id)?.state;

test('article states: draft, live on the day of now, scheduled after it', () => {
  const r = buildRunway(
    [article('a-draft', '2026-11-01', true), article('a-today', '2026-11-01'), article('a-later', '2026-11-02')],
    [],
    [],
    NOW,
  );
  assert.equal(stateOf(r, 'a-draft'), 'draft');
  assert.equal(stateOf(r, 'a-today'), 'live');
  assert.equal(stateOf(r, 'a-later'), 'scheduled');
});

test('standalone states: draft, approved past is live, approved future is scheduled', () => {
  const r = buildRunway(
    [],
    [standalone('s-draft', '2026-10-30'), standalone('s-past', '2026-10-30', 'approved'), standalone('s-future', '2026-11-05', 'approved')],
    [],
    NOW,
  );
  assert.equal(stateOf(r, 's-draft'), 'draft');
  assert.equal(stateOf(r, 's-past'), 'live');
  assert.equal(stateOf(r, 's-future'), 'scheduled');
});

test('projects: a visible case study with social is live or scheduled by social.date; the rest are omitted', () => {
  const r = buildRunway(
    [],
    [],
    [
      project('p-live', social('2026-10-27')),
      project('p-later', social('2026-12-01')),
      project('p-nosocial'),
      project('p-pending', { category: 'client', clientPermission: 'pending', ...social('2026-11-03') }),
      project('p-small', { smallerBuild: true, ...social('2026-11-03') }),
    ],
    NOW,
  );
  assert.equal(stateOf(r, 'p-live'), 'live');
  assert.equal(stateOf(r, 'p-later'), 'scheduled');
  assert.deepEqual(
    r.rows.map((row) => row.id),
    ['p-live', 'p-later'],
  );
  assert.equal(r.rows.find((row) => row.id === 'p-later').date, '2026-12-01');
});

test('VERIFY fields: body (twice) and title count 2; the exempt standalone note does not count', () => {
  const r = buildRunway([], [standalone('s-marked', '2026-11-20', 'draft', { title: MARKED, note: MARKED }, `${MARKED}\n\n${MARKED}`)], [], NOW);
  assert.equal(r.rows[0].verifyFields, 2);
  const clean = buildRunway([article('a-clean', '2026-11-20')], [], [], NOW);
  assert.equal(clean.rows[0].verifyFields, 0);
  const nested = buildRunway([article('a-nested', '2026-11-20', true, { social: { linkedin: MARKED, short: MARKED } })], [], [], NOW);
  assert.equal(nested.rows[0].verifyFields, 2, 'nested social copy counts per field');
});

test('ordering: same date runs article, standalone, project; old live rows drop, past drafts stay', () => {
  const r = buildRunway(
    [article('a-same', '2026-11-10'), article('a-old-live', '2026-10-20'), article('a-old-draft', '2026-10-01', true), article('a-week-live', '2026-10-26')],
    [standalone('s-same', '2026-11-10', 'approved'), standalone('s-old-live', '2026-10-25', 'approved')],
    [project('p-same', social('2026-11-10'))],
    NOW,
  );
  assert.deepEqual(
    r.rows.map((row) => row.id),
    ['a-old-draft', 'a-week-live', 'a-same', 's-same', 'p-same'],
  );
  const reversed = buildRunway([article('a-same', '2026-11-10')], [standalone('s-same', '2026-11-10')], [project('p-same', social('2026-11-10'))], NOW);
  assert.deepEqual(
    reversed.rows.map((row) => row.kind),
    ['article', 'standalone', 'project'],
  );
});

test('empty weeks: Mondays of article-free weeks from this week to the last article, drafts included', () => {
  // Weeks 1..5 start 2026-10-26, 11-02, 11-09, 11-16, 11-23.
  const r = buildRunway(
    [article('w1', '2026-11-01'), article('w2', '2026-11-04'), article('w5', '2026-11-29', true)],
    [standalone('s-w3', '2026-11-11', 'approved')],
    [project('p-w4', social('2026-11-18'))],
    NOW,
  );
  assert.deepEqual(r.emptyWeeks, ['2026-11-09', '2026-11-16']);
  assert.equal(r.runwayEnd, '2026-11-04', 'runway end is the last non-draft article');
  const withoutDraft = buildRunway([article('w1', '2026-11-01'), article('w2', '2026-11-04')], [], [], NOW);
  assert.deepEqual(withoutDraft.emptyWeeks, [], 'without the draft the range ends at week 2');
  const noArticles = buildRunway([], [standalone('s', '2026-11-20')], [], NOW);
  assert.deepEqual(noArticles.emptyWeeks, []);
  assert.equal(noArticles.runwayEnd, null);
});

test('warnings: drafts overdue or due by today + 7 warn; later drafts and approved posts do not', () => {
  const r = buildRunway(
    [article('a-past', '2026-10-30', true)],
    [standalone('s-edge', '2026-11-08', 'draft', { title: MARKED }), standalone('s-later', '2026-11-09'), standalone('s-approved', '2026-11-02', 'approved')],
    [],
    NOW,
  );
  assert.deepEqual(r.warnings, [
    { kind: 'article', id: 'a-past', date: '2026-10-30', verifyFields: 0 },
    { kind: 'standalone', id: 's-edge', date: '2026-11-08', verifyFields: 1 },
  ]);
  assert.equal(warningLine(r.warnings[1]), '::warning title=Runway::standalone s-edge 2026-11-08 (1 VERIFY field)');
  assert.equal(warningLine(r.warnings[0]), '::warning title=Runway::article a-past 2026-10-30 (0 VERIFY fields)');
});

test('formatRunway: a Markdown table of ids, kinds, states, dates and counts', () => {
  const md = formatRunway(buildRunway([article('a-one', '2026-11-03')], [], [], NOW));
  assert.match(md, /^\| Date \| Id \| Kind \| State \| VERIFY fields \|$/m);
  assert.match(md, /^\| 2026-11-03 \| a-one \| article \| scheduled \| 0 \|$/m);
  assert.match(md, /Runway end: 2026-11-03/);
  assert.match(md, /Empty weeks \(no article, by Monday\): 2026-10-26\./);
});

test('the lib reuses the verify-marker module and the marker is defined nowhere else in src/lib', () => {
  const src = readFileSync('src/lib/runway.ts', 'utf8');
  assert.match(src, /^import \{[^}]*\b(publishBlockers|findVerifyMarkers)\b[^}]*\} from '\.\/verify-marker\.ts';$/m);
  assert.match(src, /^import \{[^}]*\bisPublishedPost\b[^}]*\} from '\.\/visibility\.ts';$/m);
  assert.doesNotMatch(src, /from 'astro:content'/);
  const holders = readdirSync('src/lib').filter((f) => readFileSync(join('src/lib', f), 'utf8').includes('[VERIFY'));
  assert.deepEqual(holders, ['verify-marker.ts']);
});

test('check.yml runs the runway right after npm ci, with continue-on-error and no secret', () => {
  const steps = parse(readFileSync('.github/workflows/check.yml', 'utf8')).jobs.check.steps;
  const ci = steps.findIndex((s) => s.run === 'npm ci');
  const step = steps[ci + 1];
  assert.ok(ci >= 0, 'an npm ci step');
  assert.equal(step.run, 'npm run runway');
  assert.equal(step['continue-on-error'], true);
  assert.equal(JSON.stringify(step).includes('secrets.'), false, 'the runway step gets no secret');
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts.runway, 'node scripts/runway.mjs');
});

/** Runs the script on the real content with RUNWAY_NOW and a fresh step summary file. */
function runScript() {
  const dir = mkdtempSync(join(tmpdir(), 'runway-'));
  const file = join(dir, 'summary.md');
  writeFileSync(file, 'EARLIER STEP\n');
  try {
    const stdout = execFileSync(process.execPath, ['scripts/runway.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, RUNWAY_NOW: '2026-11-01', GITHUB_STEP_SUMMARY: file },
    });
    return { stdout, summary: readFileSync(file, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('smoke: the script exits 0, appends a table to the summary and prints well-formed warnings', () => {
  const { stdout, summary } = runScript(); // execFileSync throws on a non-zero exit
  assert.ok(summary.startsWith('EARLIER STEP\n'), 'appends, never overwrites');
  assert.match(summary, /^\| Date \| Id \| Kind \| State \| VERIFY fields \|$/m);
  const warnings = stdout.split('\n').filter((l) => l.startsWith('::warning'));
  for (const line of warnings) {
    assert.match(line, /^::warning title=Runway::(article|standalone) [a-z0-9-]+ \d{4}-\d{2}-\d{2} \(\d+ VERIFY fields?\)$/);
  }
});

test('confidentiality: the output carries no marker, copy, note or body text', () => {
  const { stdout, summary } = runScript();
  const out = `${stdout}\n${summary}`;
  assert.equal(out.includes('[VERIFY'), false);
  const secrets = [];
  const COPY = ['title', 'description', 'short', 'linkedin', 'note'];
  for (const dir of ['src/content/posts', 'src/content/social', 'src/content/projects']) {
    for (const { file, data, body } of entries(dir)) {
      for (const holder of [data, data.social ?? {}]) {
        for (const key of COPY) if (typeof holder[key] === 'string' && holder[key].trim()) secrets.push([`${dir}/${file} ${key}`, holder[key].trim()]);
      }
      if (body.trim()) secrets.push([`${dir}/${file} body`, body.trim().slice(0, 40)]);
    }
  }
  assert.ok(secrets.length > 50, 'collected the copy of all three collections');
  for (const [where, value] of secrets) assert.equal(out.includes(value), false, `output contains ${where}`);
});
