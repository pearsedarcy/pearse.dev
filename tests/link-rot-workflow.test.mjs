// Issue #164: the weekly external link check (.github/workflows/link-rot.yml) and the report script
// it runs. Reads the workflow YAML and fixtures only, never dist/ or the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { distPath, failures, issueBody } from '../scripts/link-rot-report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8');
const text = read('.github/workflows/link-rot.yml');
const workflow = parse(text);
// yaml 2.x (YAML 1.2) parses `on` as a string key; a YAML 1.1 parser yields boolean `true`.
const triggers = workflow.on ?? workflow[true];
const steps = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
const lychee = steps.find((s) => String(s.uses ?? '').startsWith('lycheeverse/lychee-action@'));

test('triggers are schedule and workflow_dispatch only', () => {
  assert.deepEqual(Object.keys(triggers).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(triggers.schedule.length, 1);
  const [, , dayOfMonth, month, dayOfWeek] = triggers.schedule[0].cron.trim().split(/\s+/);
  assert.deepEqual([dayOfMonth, month], ['*', '*']);
  assert.match(dayOfWeek, /^[0-6]$/, 'weekly: one day of the week');
});

test('permissions are exactly contents: read and issues: write, with no job-level widening', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read', issues: 'write' });
  for (const [id, job] of Object.entries(workflow.jobs)) assert.equal(job.permissions, undefined, id);
});

test('lychee checks dist/**/*.html only, http(s) only, excluding linkedin.com and the site origin', () => {
  assert.ok(lychee, 'a lychee-action step');
  const args = lychee.with.args;
  assert.match(args, /'dist\/\*\*\/\*\.html'\s*$/);
  assert.equal(args.match(/'[^']*\*[^']*'/g).length, 1, 'one input glob');
  assert.match(args, /--scheme http --scheme https/);
  assert.match(args, /--exclude '[^']*linkedin\\\.com[^']*'/);
  assert.match(args, /--exclude '[^']*pearse\\\.dev[^']*'/);
  for (const flag of ['--max-retries', '--timeout', '--cache', '--max-cache-age', '--root-dir']) assert.ok(args.includes(`${flag} `), flag);
  assert.match(args, /--accept '[^']*\b429\b[^']*'/);
  assert.match(args, /--format json/);
  assert.equal(lychee.with.format, 'json');
  assert.equal(lychee.with.token, '${{ github.token }}');
  assert.equal(lychee.with.fail, false, 'the report step decides, not the action');
});

test('the origin host is written at most once in the workflow', () => {
  assert.ok((text.match(/pearse\\?\.dev(?![\w-])/g) ?? []).length <= 1);
});

test('actions/cache keeps .lycheecache', () => {
  const cache = steps.find((s) => String(s.uses ?? '').startsWith('actions/cache@'));
  assert.ok(cache, 'actions/cache is used');
  assert.equal(cache.with.path, '.lycheecache');
});

test('every remote uses: is pinned to a full semver tag or a 40-character SHA', () => {
  const uses = steps.map((s) => s.uses).filter((u) => u && !u.startsWith('./'));
  assert.ok(uses.length >= 3);
  for (const u of uses) assert.match(u, /@(v\d+\.\d+\.\d+|[0-9a-f]{40})$/, u);
});

test('one step manages one labelled issue with gh: create, update by number, close on a pass', () => {
  const step = steps.find((s) => typeof s.run === 'string' && s.run.includes('gh issue'));
  assert.ok(step);
  assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
  assert.match(step.run, /node scripts\/link-rot-report\.mjs/);
  assert.match(step.run, /gh label create "\$LABEL"[^\n]*--force/);
  assert.match(step.run, /gh issue list --label "\$LABEL" --state all --limit 1/);
  assert.equal(step.run.match(/gh issue create/g).length, 1);
  assert.match(step.run, /gh issue close "\$number" --comment/);
  assert.doesNotMatch(step.run, /\$\{\{/, 'no expressions inside run: values come through env');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});

test('check.yml and deploy.yml never run lychee', () => {
  for (const f of ['check.yml', 'deploy.yml']) assert.doesNotMatch(read(`.github/workflows/${f}`), /lychee/i, f);
});

// lychee 0.24 JSON, trimmed to the fields the report reads, plus fields it must drop.
const report = {
  total: 5,
  errors: 3,
  error_map: {
    '/home/runner/work/pearse.dev/pearse.dev/dist/writing/a/index.html': [
      { url: 'https://example.com/gone', status: { text: '404 Not Found', code: 404, details: 'secret header' } },
      { url: 'https://example.org/x', status: { text: 'Redirect to https://elsewhere.example/' } },
    ],
    'dist/index.html': [{ url: 'https://example.com/gone', status: { code: 404 } }],
  },
  timeout_map: { 'dist/cv/index.html': [{ url: 'https://slow.example/', status: { text: 'Timeout' } }] },
};

test('distPath keeps the dist-relative page path', () => {
  assert.equal(distPath('/home/runner/work/x/x/dist/a/index.html'), '/a/index.html');
  assert.equal(distPath('dist/index.html'), '/index.html');
});

test('failures(): URL to sorted pages, timeouts ignored, the older fail_map read too', () => {
  const expected = [
    { url: 'https://example.com/gone', pages: ['/index.html', '/writing/a/index.html'] },
    { url: 'https://example.org/x', pages: ['/writing/a/index.html'] },
  ];
  assert.deepEqual(failures(report), expected);
  assert.deepEqual(failures({ fail_map: report.error_map }), expected);
  assert.deepEqual(failures({ error_map: {} }), []);
});

test('issueBody(): URLs and paths only, never status text, details or redirect targets', () => {
  const body = issueBody(failures(report), 'https://github.com/o/r/actions/runs/1');
  assert.match(body, /- `https:\/\/example\.com\/gone` on `\/index\.html`, `\/writing\/a\/index\.html`/);
  for (const leak of ['404', 'secret header', 'elsewhere.example', 'Redirect', 'slow.example']) assert.ok(!body.includes(leak), leak);
});

test('the script prints the count and writes a body only when something fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'link-rot-'));
  try {
    const script = resolve('scripts/link-rot-report.mjs');
    const run = (data) => {
      writeFileSync(join(dir, 'r.json'), JSON.stringify(data));
      return spawnSync(process.execPath, [script, join(dir, 'r.json'), join(dir, 'body.md'), 'RUN'], { encoding: 'utf8' });
    };
    const pass = run({ error_map: {} });
    assert.equal(pass.status, 0);
    assert.equal(pass.stdout.trim(), '0');
    assert.equal(existsSync(join(dir, 'body.md')), false);
    const fail = run(report);
    assert.equal(fail.stdout.trim(), '2');
    assert.match(readFileSync(join(dir, 'body.md'), 'utf8'), /Run: RUN\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
