// Issue #146: the zizmor and CodeQL scanner workflows, and the shape rule that keeps today's
// zizmor findings fixed. `checkShape` is pure (raw YAML text in, violations out) and runs over
// every *.yml/*.yaml in .github/workflows/, so a workflow with no `uses:` at all passes. The YAML
// parser drops comments, so the `# v…` comment is checked on the raw line. Reads no dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}.github/workflows/`;
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/;

function checkShape(text) {
  const violations = [];
  for (const line of text.split('\n')) {
    const m = line.match(USES_LINE);
    if (!m || m[1].startsWith('./')) continue;
    if (!PINNED.test(m[1])) violations.push(`${m[1]}: not pinned to a 40-hex commit SHA`);
    else if (!/^#\s*v\d/.test(m[2].trim())) violations.push(`${m[1]}: no "# v…" comment on the same line`);
  }
  for (const [jobId, job] of Object.entries(parse(text)?.jobs ?? {})) {
    if (job?.secrets === 'inherit') violations.push(`job ${jobId}: secrets: inherit`);
    for (const step of job?.steps ?? []) {
      if (!String(step?.uses ?? '').startsWith('actions/checkout@')) continue;
      const flag = step.with?.['persist-credentials'];
      if (flag !== false && flag !== 'false') violations.push(`job ${jobId}: checkout without persist-credentials: false`);
    }
  }
  return violations;
}

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const wf = (jobs) => `name: x\non: push\npermissions: {}\njobs:\n${jobs}\n`;
const good = wf(
  `  j:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@${SHA} # v7.0.1\n` +
    `        with:\n          persist-credentials: false\n      - uses: ./.github/actions/local\n` +
    `  call:\n    uses: ./.github/workflows/check.yml\n    secrets:\n      X: \${{ secrets.X }}`,
);

test('checkShape: a pinned, commented, non-persisting workflow passes', () => {
  assert.deepEqual(checkShape(good), []);
});

test('checkShape: a workflow with no uses: passes', () => {
  assert.deepEqual(checkShape(wf('  j:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: true')), []);
});

test('checkShape: a tag pin fails', () => {
  assert.match(checkShape(good.replace(`@${SHA} # v7.0.1`, '@v7')).join('\n'), /not pinned/);
});

test('checkShape: a short SHA fails', () => {
  assert.match(checkShape(good.replace(SHA, SHA.slice(0, 7))).join('\n'), /not pinned/);
});

test('checkShape: a SHA pin without the version comment fails', () => {
  assert.match(checkShape(good.replace(' # v7.0.1', '')).join('\n'), /comment/);
});

test('checkShape: a job-level remote reusable workflow must be pinned', () => {
  assert.match(checkShape(wf('  call:\n    uses: owner/repo/.github/workflows/w.yml@v1')).join('\n'), /not pinned/);
});

test('checkShape: a checkout without persist-credentials: false fails', () => {
  assert.match(checkShape(good.replace('persist-credentials: false', 'persist-credentials: true')).join('\n'), /persist-credentials/);
  assert.match(checkShape(good.replace('        with:\n          persist-credentials: false\n', '')).join('\n'), /persist-credentials/);
});

test('checkShape: secrets: inherit fails', () => {
  assert.match(checkShape(good.replace('secrets:\n      X: ${{ secrets.X }}', 'secrets: inherit')).join('\n'), /inherit/);
});

const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

test('the workflows directory includes both scanners', () => {
  for (const f of ['zizmor.yml', 'codeql.yml']) assert.ok(files.includes(f), `${f} in ${files.join(', ')}`);
});

for (const file of files) {
  test(`${file}: passes the shape rule`, () => {
    assert.deepEqual(checkShape(readFileSync(`${DIR}${file}`, 'utf8')), []);
  });
}

const load = (f) => {
  const text = readFileSync(`${DIR}${f}`, 'utf8');
  return { text, wf: parse(text) };
};
const zizmor = load('zizmor.yml');
const codeql = load('codeql.yml');
const steps = (w) => Object.values(w.jobs).flatMap((j) => j.steps ?? []);

for (const [name, { text, wf: w }] of [['zizmor.yml', zizmor], ['codeql.yml', codeql]]) {
  test(`${name}: least privilege, no pull_request_target, no expressions in run:`, () => {
    assert.ok(
      JSON.stringify(w.permissions) === '{}' || JSON.stringify(w.permissions) === '{"contents":"read"}',
      `top-level permissions ${JSON.stringify(w.permissions)}`,
    );
    for (const [id, job] of Object.entries(w.jobs)) {
      assert.equal(job.permissions?.['security-events'], 'write', `job ${id}: security-events: write`);
      for (const [scope, level] of Object.entries(job.permissions)) {
        if (scope !== 'security-events') assert.equal(level, 'read', `job ${id}: ${scope} is ${level}`);
      }
    }
    assert.ok(!('pull_request_target' in w.on), 'no pull_request_target');
    assert.doesNotMatch(text, /pull_request_target/);
    for (const step of steps(w)) {
      if (step.run !== undefined) assert.doesNotMatch(step.run, /\$\{\{/, `step ${step.name}: expression in run:`);
    }
  });

  test(`${name}: runs weekly and by hand`, () => {
    assert.equal(w.on.schedule?.length, 1);
    const [, , dom, month, dow] = w.on.schedule[0].cron.trim().split(/\s+/);
    assert.deepEqual([dom, month], ['*', '*']);
    assert.match(dow, /^[0-6]$/);
    assert.ok('workflow_dispatch' in w.on);
  });
}

test('zizmor.yml: pull requests touching .github/ only', () => {
  assert.deepEqual(zizmor.wf.on.pull_request, { paths: ['.github/**'] });
  assert.ok(!('push' in zizmor.wf.on));
});

test('zizmor.yml: one exact version, online, SARIF, report-only', () => {
  const run = steps(zizmor.wf).find((s) => /\bzizmor\b/.test(s.run ?? ''));
  assert.ok(run, 'a step runs zizmor');
  assert.match(run.run, /zizmor==\d+\.\d+\.\d+ /, 'exact version');
  assert.doesNotMatch(run.run, /latest|--offline|--min-severity|\|\|/);
  assert.match(run.run, /--format sarif/);
  assert.match(run.run, /--no-exit-codes/, 'findings alone do not fail the job');
  assert.equal(run.env?.GH_TOKEN, '${{ github.token }}', 'online mode');
});

test('zizmor.yml: the SARIF is uploaded to code scanning under its own category', () => {
  const upload = steps(zizmor.wf).find((s) => String(s.uses).startsWith('github/codeql-action/upload-sarif@'));
  assert.ok(upload, 'upload-sarif step');
  assert.equal(upload.with?.category, 'zizmor');
  assert.equal(upload.if, undefined, 'no condition that could skip or mask the upload');
  assert.equal(upload['continue-on-error'], undefined);
});

test('codeql.yml: actions and javascript-typescript, build-mode none', () => {
  const job = Object.values(codeql.wf.jobs)[0];
  assert.deepEqual(job.strategy.matrix.language, ['actions', 'javascript-typescript']);
  assert.equal(job.permissions.actions, 'read');
  const init = steps(codeql.wf).find((s) => String(s.uses).startsWith('github/codeql-action/init@'));
  assert.equal(init.with['build-mode'], 'none');
  assert.equal(init.with.languages, '${{ matrix.language }}');
  assert.ok(steps(codeql.wf).some((s) => String(s.uses).startsWith('github/codeql-action/analyze@')));
});

test('codeql.yml: pull requests and pushes to master on the same paths', () => {
  const { pull_request: pr, push } = codeql.wf.on;
  assert.deepEqual(push.branches, ['master']);
  assert.deepEqual(push.paths, pr.paths);
  assert.ok(pr.paths.includes('.github/**'));
  for (const ext of ['js', 'mjs', 'ts']) assert.ok(pr.paths.includes(`**/*.${ext}`), ext);
});
