// Issue #267: the `report` job in deploy.yml opens, updates, reopens or closes a deploy-failed
// tracking issue. Parses the workflow with `yaml`, then runs the job's one `run:` step the way the
// Actions runner does (`bash --noprofile --norc -eo pipefail`) against a stub `gh`. Reads no
// dist/ and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const workflow = parse(readFileSync(`${ROOT}.github/workflows/deploy.yml`, 'utf8'));
const report = workflow.jobs.report;

test('report needs check and deploy and runs after a failure, on master only', () => {
  assert.deepEqual([...report.needs].sort(), ['check', 'deploy']);
  assert.match(String(report.if), /!cancelled\(\)/);
  assert.match(String(report.if), /refs\/heads\/master/);
});

test('report has issues: write at job level only, and the top level stays contents: read', () => {
  assert.deepEqual(report.permissions, { issues: 'write' });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
});

test('report runs on ubuntu-24.04 with one run step, no uses, and no expression inside run', () => {
  assert.equal(report['runs-on'], 'ubuntu-24.04');
  assert.equal(report.steps.length, 1);
  const [step] = report.steps;
  assert.equal(step.uses, undefined);
  assert.equal(typeof step.run, 'string');
  assert.doesNotMatch(step.run, /\$\{\{/);
  assert.doesNotMatch(step.run, /\bgh api\b/);
  assert.equal(step.env.LABEL, 'deploy-failed');
  assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
  assert.ok('GH_REPO' in step.env && 'NEEDS_CHECK' in step.env && 'NEEDS_DEPLOY' in step.env);
});

const STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
if [ "$1" = issue ] && [ "$2" = list ]; then printf '%s' "$STUB_LATEST"; fi
prev=""
for arg in "$@"; do
  if [ "$prev" = --body-file ]; then cp "$arg" "$STUB_LOGDIR/body-$1-$2.md"; fi
  prev="$arg"
done
exit 0
`;

const RUN_URL = 'https://example.test/owner/repo/actions/runs/777';
const SHA = '0123456789abcdef0123456789abcdef01234567';

function run({ check, deploy, latest, event = 'schedule' }) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-report-'));
  try {
    const stubdir = join(dir, 'bin');
    mkdirSync(stubdir);
    writeFileSync(join(stubdir, 'gh'), STUB);
    chmodSync(join(stubdir, 'gh'), 0o755);
    const script = join(dir, 'step.sh');
    writeFileSync(script, report.steps[0].run);
    const log = join(dir, 'gh.log');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      encoding: 'utf8',
      env: {
        PATH: `${stubdir}:${process.env.PATH}`,
        GITHUB_RUN_ID: '777',
        GITHUB_SERVER_URL: 'https://example.test',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_SHA: SHA,
        GITHUB_EVENT_NAME: event,
        RUNNER_TEMP: dir,
        GH_REPO: 'owner/repo',
        GH_TOKEN: 'dummy',
        LABEL: report.steps[0].env.LABEL,
        NEEDS_CHECK: check,
        NEEDS_DEPLOY: deploy,
        STUB_LATEST: latest,
        STUB_LOG: log,
        STUB_LOGDIR: dir,
      },
    });
    const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    const bodies = Object.fromEntries(
      readdirSync(dir).filter((f) => f.startsWith('body-')).map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
    );
    return { status: result.status, stderr: result.stderr, lines, bodies, all: lines.join('\n') + Object.values(bodies).join('\n') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const starts = (lines, prefix) => lines.filter((l) => l.startsWith(prefix));
const noWrites = (r) => {
  for (const p of ['issue create', 'issue comment', 'issue reopen', 'issue close', 'api']) {
    assert.deepEqual(starts(r.lines, p), [], `unexpected ${p}`);
  }
};

function assertBody(body, jobs) {
  assert.match(body, new RegExp(`Failed jobs: ${jobs}\\b`));
  assert.ok(body.includes('Event: schedule'));
  assert.ok(body.includes(SHA));
  assert.ok(body.includes(RUN_URL));
}

test('case 1: check failed, no issue yet: creates the labelled issue with a body', () => {
  const r = run({ check: 'failure', deploy: 'skipped', latest: '' });
  assert.equal(r.status, 0, r.stderr);
  const created = starts(r.lines, 'issue create');
  assert.equal(created.length, 1);
  assert.match(created[0], /--label deploy-failed/);
  assert.match(created[0], /--title Publishing failed/);
  assert.deepEqual(starts(r.lines, 'issue comment'), []);
  assertBody(r.bodies['body-issue-create.md'], 'check');
  assert.equal(r.bodies['body-issue-create.md'].includes('deploy,'), false);
});

test('case 2: the jq output null also creates', () => {
  const r = run({ check: 'failure', deploy: 'skipped', latest: 'null' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(starts(r.lines, 'issue create').length, 1);
  assert.deepEqual(starts(r.lines, 'issue comment'), []);
});

test('case 3: deploy failed, newest issue open: comments only', () => {
  const r = run({ check: 'success', deploy: 'failure', latest: '12 OPEN' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(starts(r.lines, 'issue comment 12').length, 1);
  for (const p of ['issue create', 'issue reopen', 'issue close', 'api']) assert.deepEqual(starts(r.lines, p), [], p);
  assertBody(r.bodies['body-issue-comment.md'], 'deploy');
});

test('case 4: check failed, newest issue closed: reopens then comments, never calls the API', () => {
  const r = run({ check: 'failure', deploy: 'skipped', latest: '12 CLOSED' });
  assert.equal(r.status, 0, r.stderr);
  const reopen = r.lines.findIndex((l) => l.startsWith('issue reopen 12'));
  const comment = r.lines.findIndex((l) => l.startsWith('issue comment 12'));
  assert.ok(reopen >= 0 && comment > reopen, 'reopen, then comment');
  assert.deepEqual(starts(r.lines, 'issue create'), []);
  assert.deepEqual(starts(r.lines, 'api'), []);
});

test('both jobs failing are both named', () => {
  const r = run({ check: 'failure', deploy: 'failure', latest: '12 OPEN' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.bodies['body-issue-comment.md'], /Failed jobs: check, deploy/);
});

test('case 5: both succeeded, newest issue open: closes it with the run URL', () => {
  const r = run({ check: 'success', deploy: 'success', latest: '12 OPEN' });
  assert.equal(r.status, 0, r.stderr);
  const closed = starts(r.lines, 'issue close 12');
  assert.equal(closed.length, 1);
  assert.ok(closed[0].includes(RUN_URL));
  for (const p of ['issue create', 'issue comment', 'issue reopen', 'api']) assert.deepEqual(starts(r.lines, p), [], p);
});

test('case 6: both succeeded, newest issue closed or none: does nothing', () => {
  for (const latest of ['12 CLOSED', '', 'null']) {
    const r = run({ check: 'success', deploy: 'success', latest });
    assert.equal(r.status, 0, `${latest}: ${r.stderr}`);
    noWrites(r);
  }
});

test('case 7: cancelled or skipped without a failure does nothing and exits 0', () => {
  for (const [check, deploy] of [['cancelled', 'skipped'], ['success', 'cancelled'], ['success', 'skipped'], ['skipped', 'skipped']]) {
    const r = run({ check, deploy, latest: '12 OPEN' });
    assert.equal(r.status, 0, `${check}/${deploy}: ${r.stderr}`);
    noWrites(r);
    assert.deepEqual(starts(r.lines, 'issue list'), [], 'does not even look');
  }
});

test('case 8: every case exits 0 and nothing carries the token or the word build', () => {
  const combos = [
    ['failure', 'skipped', ''], ['failure', 'skipped', 'null'], ['success', 'failure', '12 OPEN'],
    ['failure', 'skipped', '12 CLOSED'], ['success', 'success', '12 OPEN'], ['success', 'success', '12 CLOSED'],
    ['cancelled', 'skipped', ''],
  ];
  for (const [check, deploy, latest] of combos) {
    const r = run({ check, deploy, latest, event: 'workflow_dispatch' });
    assert.equal(r.status, 0, `${check}/${deploy}/${latest}: ${r.stderr}`);
    assert.equal(r.all.includes('dummy'), false, 'GH_TOKEN value never reaches a body or an argument');
    assert.doesNotMatch(r.all, /build/i);
  }
});
