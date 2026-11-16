// Issue #344: the ahead build. The pure aheadDate (src/lib/ahead.ts) on invented fixtures with a
// fixed `now`; scripts/ahead-date.mjs on the real content (the date it prints and writes to
// $GITHUB_OUTPUT, slug and date only); and the shape of .github/workflows/ahead.yml: triggers,
// schedule, concurrency, steps, the SITE_NOW source and no upload or deploy. Reads sources and
// workflow YAML, never dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { aheadDate, aheadLine, FALLBACK_DAYS } from '../src/lib/ahead.ts';
import { entries } from '../scripts/content-entries.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ---- aheadDate -----------------------------------------------------------------------------------

const NOW = new Date('2026-11-16T05:41:00Z');
const article = (id, pubDate, draft = false) => ({ id, data: { title: `Title of ${id}`, pubDate, draft } });

test('aheadDate: the earliest non-draft article dated after now, by slug and date', () => {
  const got = aheadDate(
    [article('later', '2026-12-01'), article('next', '2026-11-24'), article('live', '2026-11-10'), article('draft-sooner', '2026-11-18', true)],
    NOW,
  );
  assert.deepEqual(got, { siteNow: '2026-11-24', slug: 'next' });
});

test('aheadDate: an article dated today is already live and does not count; tomorrow does', () => {
  assert.deepEqual(aheadDate([article('today', '2026-11-16'), article('tomorrow', '2026-11-17')], NOW), { siteNow: '2026-11-17', slug: 'tomorrow' });
});

test('aheadDate: drafts never drive it, whatever their date', () => {
  assert.deepEqual(aheadDate([article('d', '2026-11-20', true), article('s', '2027-03-01')], NOW), { siteNow: '2027-03-01', slug: 's' });
});

test('aheadDate: two articles on one date pick the first slug, whatever the input order', () => {
  const pair = [article('b-second', '2026-11-24'), article('a-first', '2026-11-24')];
  assert.equal(aheadDate(pair, NOW).slug, 'a-first');
  assert.equal(aheadDate([...pair].reverse(), NOW).slug, 'a-first');
});

test('aheadDate: Date pubDates work as YAML strings do', () => {
  assert.deepEqual(aheadDate([article('d', new Date('2026-11-24T00:00:00Z'))], NOW), { siteNow: '2026-11-24', slug: 'd' });
});

test('aheadDate: a pubDate with a time of day gives that instant, so the article is published ahead', () => {
  assert.deepEqual(aheadDate([article('t', '2026-11-16T10:00:00Z')], NOW), { siteNow: '2026-11-16T10:00:00.000Z', slug: 't' });
});

test(`aheadDate: with nothing scheduled, today (UTC) + ${FALLBACK_DAYS} days, across a month and a year`, () => {
  assert.equal(FALLBACK_DAYS, 14);
  assert.deepEqual(aheadDate([], NOW), { siteNow: '2026-11-30' });
  assert.deepEqual(aheadDate([article('live', '2026-11-10'), article('d', '2026-12-01', true)], NOW), { siteNow: '2026-11-30' });
  assert.deepEqual(aheadDate([], new Date('2026-12-25T23:59:59Z')), { siteNow: '2027-01-08' });
});

test('aheadDate: a pubDate that is not a date throws, naming the article', () => {
  assert.throws(() => aheadDate([article('bad', 'soon')], NOW), /article "bad" pubDate/);
});

test('aheadLine: the date and the slug, never a title', () => {
  assert.equal(aheadLine({ siteNow: '2026-11-24', slug: 'next' }), 'ahead date: 2026-11-24 (next scheduled article: next)');
  assert.equal(aheadLine({ siteNow: '2026-11-30' }), 'ahead date: 2026-11-30 (no scheduled article: today + 14 days)');
});

// ---- scripts/ahead-date.mjs ------------------------------------------------------------------------

/** Runs the script with SITE_NOW and a fresh $GITHUB_OUTPUT file; returns the result and that file's text. */
function runScript(siteNow) {
  const dir = mkdtempSync(join(tmpdir(), 'ahead-'));
  const out = join(dir, 'output');
  try {
    const r = spawnSync(process.execPath, ['scripts/ahead-date.mjs'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SITE_NOW: siteNow, GITHUB_OUTPUT: out } });
    let output = '';
    try {
      output = readFileSync(out, 'utf8');
    } catch {
      // No file: the script failed before writing.
    }
    return { ...r, output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const realArticles = () => entries('src/content/posts').map(({ file, data }) => ({ id: data.slug ?? file.replace(/\.mdx?$/, ''), data }));

test('ahead-date: on the real content, prints one line and writes date= to $GITHUB_OUTPUT', () => {
  for (const at of ['2026-11-16', '2030-01-01']) {
    const expected = aheadDate(realArticles(), new Date(`${at}T00:00:00Z`));
    const r = runScript(at);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${aheadLine(expected)}\n`);
    assert.equal(r.output, `date=${expected.siteNow}\n`);
  }
});

test('ahead-date: names slugs and dates only, never an article title', () => {
  const r = runScript('2026-11-16');
  for (const { data } of entries('src/content/posts')) assert.ok(!r.stdout.includes(String(data.title)), 'a title in the output');
});

test('ahead-date: an invalid SITE_NOW exits 1 naming it and writes no output', () => {
  const r = runScript('nonsense');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ahead: SITE_NOW="nonsense" is not a date/m);
  assert.equal(r.output, '');
});

test('npm run ahead runs the script', () => {
  assert.equal(JSON.parse(read('package.json')).scripts.ahead, 'node scripts/ahead-date.mjs');
});

// ---- .github/workflows/ahead.yml -----------------------------------------------------------------

const workflow = parse(read('.github/workflows/ahead.yml'));
const check = parse(read('.github/workflows/check.yml'));
const deploy = parse(read('.github/workflows/deploy.yml'));
// yaml 2.x (YAML 1.2) parses `on` as a string key; a YAML 1.1 parser yields boolean `true`.
const triggers = workflow.on ?? workflow[true];
const job = workflow.jobs?.ahead;
const steps = job?.steps ?? [];
const SOURCE = '${{ steps.ahead.outputs.date }}';
const CHECKS = [
  ['Type and content check', 'npm run check'],
  ['Build', 'npm run build'],
  ['Tests', 'npm run test:ci'],
  ['Link crawl', 'npm run links'],
  ['Accessibility scan', 'npm run a11y'],
  ['Confidentiality gate', 'npm run gate'],
];

test('ahead.yml: pull requests (unfiltered), pushes to master and a daily 05:41 UTC schedule, nothing else', () => {
  assert.deepEqual(Object.keys(triggers).sort(), ['pull_request', 'push', 'schedule']);
  assert.equal(triggers.pull_request, null, 'no paths or branches filter on pull_request');
  assert.deepEqual(triggers.push, { branches: ['master'] });
  assert.deepEqual(triggers.schedule, [{ cron: '41 5 * * *' }]);
});

test("ahead.yml: the schedule runs after deploy.yml's 04:23 UTC rebuild, the same day", () => {
  const minutes = (cron) => {
    const [m, h] = cron.split(/\s+/).map(Number);
    return h * 60 + m;
  };
  const rebuild = deploy.on.schedule.map((s) => s.cron);
  assert.deepEqual(rebuild, ['23 4 * * *']);
  assert.ok(minutes(triggers.schedule[0].cron) > minutes(rebuild[0]));
});

test('ahead.yml: concurrency per ref, cancelling in progress on pull requests only, as check.yml does', () => {
  assert.match(workflow.concurrency.group, /^ahead-.*\$\{\{ github\.ref \}\}$/);
  assert.equal(workflow.concurrency['cancel-in-progress'], check.concurrency['cancel-in-progress']);
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
});

test('ahead.yml: contents: read only, one job, no job-level permissions', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['ahead']);
  assert.equal(job.permissions, undefined);
  assert.equal(job['runs-on'], 'ubuntu-24.04');
});

test('ahead.yml: checkout, Node, npm ci, the ahead date, then check, build, test:ci, links, a11y and gate', () => {
  assert.match(steps[0].uses, /^actions\/checkout@[0-9a-f]{40}$/);
  assert.equal(steps[0].with['fetch-depth'], 0, 'full history, as check.yml');
  assert.equal(steps[0].with['persist-credentials'], false);
  assert.match(steps[1].uses, /^actions\/setup-node@[0-9a-f]{40}$/);
  assert.equal(steps[1].with['node-version'], check.jobs.check.steps.find((s) => s.name === 'Set up Node').with['node-version']);
  assert.equal(steps[2].run, 'npm ci');
  assert.deepEqual([steps[3].name, steps[3].id, steps[3].run], ['Ahead date', 'ahead', 'npm run ahead']);
  assert.deepEqual(
    steps.slice(4).map((s) => [s.name, s.run]),
    CHECKS,
  );
});

test('ahead.yml: every check reads SITE_NOW from the ahead step output, and nothing before it sets SITE_NOW', () => {
  assert.equal(workflow.env, undefined, 'no workflow-level env');
  assert.equal(job.env, undefined, 'no job-level env');
  for (const s of steps.slice(0, 4)) assert.equal(s.env?.SITE_NOW, undefined, `${s.name ?? s.run} runs at the real clock`);
  for (const s of steps.slice(4)) {
    assert.equal(s.env?.SITE_NOW, SOURCE, `${s.name}`);
    assert.equal(s.if, undefined, `${s.name} has no condition`);
    assert.equal(s['continue-on-error'], undefined, `${s.name} can fail the run`);
  }
});

test('ahead.yml: Build has the GitHub token and the gate is configured exactly as in check.yml', () => {
  assert.equal(steps.find((s) => s.name === 'Build').env.GITHUB_TOKEN, '${{ github.token }}');
  const { SITE_NOW, ...gateEnv } = steps.find((s) => s.name === 'Confidentiality gate').env;
  assert.equal(SITE_NOW, SOURCE);
  assert.deepEqual(gateEnv, check.jobs.check.steps.find((s) => s.name === 'Confidentiality gate').env);
  assert.equal(steps.find((s) => s.name === 'Accessibility scan')['timeout-minutes'], 4);
});

test('ahead.yml: no upload, deploy, Lighthouse or cache-save step, and no write permission anywhere', () => {
  const uses = steps.filter((s) => s.uses).map((s) => s.uses.split('@')[0]);
  assert.deepEqual(uses, ['actions/checkout', 'actions/setup-node'], 'no other action');
  const text = read('.github/workflows/ahead.yml');
  for (const banned of [/upload-artifact/, /upload-pages-artifact/, /deploy-pages/, /upload-sarif/, /actions\/cache/, /\blhci\b/, /:\s*write\b/]) {
    assert.doesNotMatch(text, banned);
  }
  for (const s of steps) assert.doesNotMatch(String(s.run ?? ''), /deploy|upload|lhci|gh /, `${s.name ?? s.run}`);
});

test('ahead.yml is not re-enabled by keepalive.yml and is called by no other workflow', () => {
  assert.doesNotMatch(read('.github/workflows/keepalive.yml'), /ahead/);
  for (const f of ['check.yml', 'deploy.yml']) assert.doesNotMatch(read(`.github/workflows/${f}`), /ahead/, f);
});
