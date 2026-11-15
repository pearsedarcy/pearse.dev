// `scripts/install-hooks.mjs` (run by `npm run prepare`) sets core.hooksPath to `.githooks` and
// must always exit 0 (#127). Temp repos only; reads no dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve('scripts/install-hooks.mjs');

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k === 'CI') delete env[k];
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return { ...env, ...extra };
}

function git(dir, ...args) {
  return spawnSync('git', args, { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
}

function install(dir, extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT], { cwd: dir, env: cleanEnv(extraEnv), encoding: 'utf8' });
}

function withDir(init, fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'install-hooks-')));
  try {
    if (init) git(dir, 'init', '-q');
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hooksPath = (dir) => git(dir, 'config', '--get', 'core.hooksPath').stdout.trim();

test('in a git repo it sets core.hooksPath to .githooks and exits 0', () => {
  withDir(true, (dir) => {
    const r = install(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(hooksPath(dir), '.githooks');
  });
});

test('running it twice is idempotent and quiet the second time', () => {
  withDir(true, (dir) => {
    install(dir);
    const r = install(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, '');
    assert.equal(hooksPath(dir), '.githooks');
  });
});

test('with CI set it exits 0 and changes nothing', () => {
  withDir(true, (dir) => {
    const r = install(dir, { CI: 'true' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, '');
    assert.equal(hooksPath(dir), '');
  });
});

test('outside a git work tree it exits 0 and prints nothing', () => {
  withDir(false, (dir) => {
    const r = install(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, '');
  });
});

test('an existing different core.hooksPath is warned about and left unchanged', () => {
  withDir(true, (dir) => {
    git(dir, 'config', 'core.hooksPath', 'elsewhere');
    const r = install(dir);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /already set/);
    assert.equal(hooksPath(dir), 'elsewhere');
  });
});

test('with git missing from PATH it still exits 0', () => {
  withDir(true, (dir) => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, env: cleanEnv({ PATH: dir }), encoding: 'utf8' });
    assert.equal(r.status, 0);
  });
});

test('package.json carries one prepare script that runs it, and no hook dependency', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts.prepare, 'node scripts/install-hooks.mjs');
  for (const name of ['husky', 'simple-git-hooks', 'lint-staged']) {
    assert.equal(name in (pkg.dependencies ?? {}), false);
    assert.equal(name in (pkg.devDependencies ?? {}), false);
  }
});
