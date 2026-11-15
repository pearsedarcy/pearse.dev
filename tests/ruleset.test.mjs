// Issue #284: the `master` ruleset lives in the repo as JSON that `gh api` accepts. It blocks
// deletion and force-push and requires a pull request and the `check` job; no actor bypasses it.
// Parses the ruleset and check.yml only; reads no dist/. Applying the ruleset is a repo-admin step
// (README "Branch ruleset"), so this test is what keeps the JSON and the workflow in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${ROOT}${path}`, 'utf8');
const ruleset = JSON.parse(read('.github/rulesets/master.json'));
const checkWorkflow = parse(read('.github/workflows/check.yml'));

const ruleOf = (r, type) => (r.rules ?? []).find((x) => x.type === type);
const requiredContexts = (r) =>
  (ruleOf(r, 'required_status_checks')?.parameters?.required_status_checks ?? []).map((c) => c.context);

// A required check that does not report on every pull request blocks every merge, forever
// pending. Returns what would make that happen; empty means the ruleset and workflow agree.
const FILTERS = ['paths', 'paths-ignore', 'branches', 'branches-ignore'];
function contextProblems(r, workflow) {
  const problems = [];
  const jobs = Object.keys(workflow.jobs ?? {});
  for (const context of requiredContexts(r)) {
    if (!jobs.includes(context)) {
      problems.push(`required check "${context}" is not a job id in check.yml (jobs: ${jobs.join(', ')})`);
    }
  }
  const trigger = workflow.on ?? workflow.true;
  if (!trigger || typeof trigger !== 'object' || !('pull_request' in trigger)) {
    problems.push('check.yml has no pull_request trigger');
  } else {
    const pr = trigger.pull_request ?? {};
    for (const key of FILTERS) {
      if (key in pr) problems.push(`check.yml pull_request trigger has a "${key}" filter`);
    }
  }
  return problems;
}

test('the ruleset targets master only, is active and has no bypass actor', () => {
  assert.equal(ruleset.name, 'master');
  assert.equal(ruleset.target, 'branch');
  assert.equal(ruleset.enforcement, 'active');
  assert.deepEqual(ruleset.conditions.ref_name.include, ['refs/heads/master']);
  assert.deepEqual(ruleset.conditions.ref_name.exclude, []);
  assert.deepEqual(ruleset.bypass_actors, []);
});

test('exactly four rule types, and no code_scanning rule', () => {
  const types = ruleset.rules.map((r) => r.type).sort();
  assert.deepEqual(types, ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks']);
  assert.ok(!types.includes('code_scanning'), 'scanners are report-only (README, #146)');
});

test('pull_request rule: merge commits only, no approvals needed, no stale-review dismissal', () => {
  const p = ruleOf(ruleset, 'pull_request').parameters;
  assert.deepEqual(p.allowed_merge_methods, ['merge']);
  assert.equal(p.required_approving_review_count, 0);
  for (const key of [
    'dismiss_stale_reviews_on_push',
    'require_code_owner_review',
    'require_last_push_approval',
    'required_review_thread_resolution',
  ]) {
    assert.equal(p[key], false, key);
  }
});

test('required_status_checks: one check from the GitHub Actions app, not strict', () => {
  const p = ruleOf(ruleset, 'required_status_checks').parameters;
  assert.equal(p.strict_required_status_checks_policy, false, 'strict breaks back-to-back merging');
  assert.deepEqual(p.required_status_checks, [{ context: 'check', integration_id: 15368 }]);
});

test('every required context is a job id in check.yml, and check.yml runs on every pull request', () => {
  assert.deepEqual(contextProblems(ruleset, checkWorkflow), []);
});

// Fixtures: prove each way of drifting can fail.
const withContexts = (...contexts) => ({
  rules: [
    {
      type: 'required_status_checks',
      parameters: { required_status_checks: contexts.map((context) => ({ context })) },
    },
  ],
});
const workflowWith = (pullRequest) => ({ on: { pull_request: pullRequest }, jobs: { check: {} } });

test('fixture: the matching shape passes', () => {
  assert.deepEqual(contextProblems(withContexts('check'), workflowWith(null)), []);
});

test('fixture: a context that is not a job id fails (display strings, renamed job)', () => {
  for (const context of ['Check / check', 'check / check', 'build']) {
    const problems = contextProblems(withContexts(context), workflowWith(null));
    assert.equal(problems.length, 1, context);
    assert.match(problems[0], /not a job id/);
  }
});

test('fixture: a path or branch filter on the pull_request trigger fails', () => {
  for (const key of FILTERS) {
    const problems = contextProblems(withContexts('check'), workflowWith({ [key]: ['x/**'] }));
    assert.equal(problems.length, 1, key);
    assert.match(problems[0], new RegExp(key));
  }
});

test('fixture: a workflow with no pull_request trigger fails', () => {
  const problems = contextProblems(withContexts('check'), { on: { push: null }, jobs: { check: {} } });
  assert.deepEqual(problems, ['check.yml has no pull_request trigger']);
});
