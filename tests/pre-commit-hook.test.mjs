// `.githooks/pre-commit` runs `node scripts/gate.mjs --staged` on every commit (#127). Every case
// builds a throwaway repo under os.tmpdir() whose core.hooksPath is this checkout's real hook, and
// uses a synthetic token only; the real denylist is never read. Reads no dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, statSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HOOKS = resolve('.githooks');
const GATE = resolve('scripts/gate.mjs');
const TOKEN = 'PlantedSecret123';
const PATTERN = 'plantedsecret123';
const GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

/** A child env with nothing from the host: no GIT_* (set inside a hook), no patterns, no config. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, GITHUB_ACTIONS: '' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  delete env.CONFIDENTIAL_PATTERNS;
  delete env.GATE_REQUIRED;
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return { ...env, ...extra };
}

function git(dir, args, extraEnv = {}) {
  return spawnSync(GIT, args, { cwd: dir, env: cleanEnv(extraEnv), encoding: 'utf8' });
}

function mustGit(dir, ...args) {
  const r = git(dir, args);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A temp repo with an identity, this checkout's hook installed and an initial commit. */
function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pre-commit-hook-')));
  mustGit(dir, 'init', '-q');
  mustGit(dir, 'config', 'user.name', 'Test');
  mustGit(dir, 'config', 'user.email', 'test@example.invalid');
  mustGit(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README'), 'clean\n');
  mustGit(dir, 'add', 'README');
  mustGit(dir, 'commit', '-q', '-m', 'init');
  mustGit(dir, 'config', 'core.hooksPath', HOOKS);
  return dir;
}

function withRepo(fn) {
  const dir = repo();
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run `git commit` and return the status and the combined output. */
function commit(dir, args = ['-m', 'probe'], { env = {}, cwd = dir } = {}) {
  const r = spawnSync(GIT, ['commit', '-q', ...args], { cwd, env: cleanEnv(env), encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function head(dir) {
  return mustGit(dir, 'rev-parse', 'HEAD');
}

test('the hook is tracked executable, in POSIX sh, and sets no gate variable', () => {
  const mode = statSync(join(HOOKS, 'pre-commit')).mode;
  assert.ok(mode & 0o100, 'pre-commit is not executable on disk');
  const src = readFileSync(join(HOOKS, 'pre-commit'), 'utf8');
  assert.match(src, /^#!\/bin\/sh\n/);
  assert.doesNotMatch(src, /GATE_REQUIRED/);
  assert.doesNotMatch(src, /unset|GIT_INDEX_FILE=|GIT_DIR=/);
  const r = spawnSync(GIT, ['ls-files', '-s', '.githooks/pre-commit'], { encoding: 'utf8', env: cleanEnv() });
  if (r.status === 0 && r.stdout.trim()) assert.match(r.stdout, /^100755 /);
});

test('a staged token blocks the commit, names path and pattern, never prints the token', () => {
  withRepo((dir) => {
    const before = head(dir);
    writeFileSync(join(dir, 'note.txt'), `hello ${TOKEN}\n`);
    mustGit(dir, 'add', 'note.txt');
    const r = commit(dir, ['-m', 'probe'], { env: { CONFIDENTIAL_PATTERNS: `nomatch\n${PATTERN}\n` } });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /^note\.txt: pattern #2$/m);
    assert.doesNotMatch(r.out.toLowerCase(), new RegExp(PATTERN));
    assert.equal(head(dir), before);
  });
});

test('staged, then deleted from the working tree, the index still blocks', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'note.txt'), `${TOKEN}\n`);
    mustGit(dir, 'add', 'note.txt');
    rmSync(join(dir, 'note.txt'));
    const r = commit(dir, ['-m', 'probe'], { env: { CONFIDENTIAL_PATTERNS: PATTERN } });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /^note\.txt: pattern #1$/m);
  });
});

test('a clean staged file with a token only in an unstaged edit commits', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'note.txt'), 'clean\n');
    mustGit(dir, 'add', 'note.txt');
    writeFileSync(join(dir, 'note.txt'), `clean\n${TOKEN}\n`);
    const r = commit(dir, ['-m', 'probe'], { env: { CONFIDENTIAL_PATTERNS: PATTERN } });
    assert.equal(r.status, 0, r.out);
  });
});

test('git commit -a on a tracked file edited to hold the token is blocked (GIT_INDEX_FILE honoured)', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'README'), `clean\n${TOKEN}\n`);
    const r = commit(dir, ['-a', '-m', 'probe'], { env: { CONFIDENTIAL_PATTERNS: PATTERN } });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /^README: pattern #1$/m);
  });
});

test('git commit <path> is blocked too, and a clean one passes', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'README'), `clean\n${TOKEN}\n`);
    const blocked = commit(dir, ['-m', 'probe', 'README'], { env: { CONFIDENTIAL_PATTERNS: PATTERN } });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.out, /^README: pattern #1$/m);
    writeFileSync(join(dir, 'README'), 'clean again\n');
    const ok = commit(dir, ['-m', 'probe', 'README'], { env: { CONFIDENTIAL_PATTERNS: PATTERN } });
    assert.equal(ok.status, 0, ok.out);
  });
});

test('from a subdirectory the hook still finds the gate and the top-level patterns', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, '.confidential-patterns'), `${PATTERN}\n`);
    mkdirSync(join(dir, 'deep', 'er'), { recursive: true });
    writeFileSync(join(dir, 'deep', 'er', 'x.txt'), `${TOKEN}\n`);
    mustGit(dir, 'add', 'deep/er/x.txt');
    const r = commit(dir, ['-m', 'probe'], { cwd: join(dir, 'deep', 'er') });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /^deep\/er\/x\.txt: pattern #1$/m);
  });
});

test('with no patterns anywhere the commit succeeds and carries the no-patterns warning', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'note.txt'), `${TOKEN}\n`);
    mustGit(dir, 'add', 'note.txt');
    const r = commit(dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /NO PATTERNS CONFIGURED/);
  });
});

test('in a linked worktree, patterns only at the main worktree root still block', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, '.confidential-patterns'), `${PATTERN}\n`);
    const wt = join(dir, '..', `${dir.split('/').pop()}-wt`);
    mustGit(dir, 'worktree', 'add', '-q', '-b', 'linked', wt);
    try {
      writeFileSync(join(wt, 'note.txt'), `${TOKEN}\n`);
      mustGit(wt, 'add', 'note.txt');
      const r = commit(wt);
      assert.notEqual(r.status, 0);
      assert.match(r.out, /^note\.txt: pattern #1$/m);
      assert.doesNotMatch(r.out.toLowerCase(), new RegExp(PATTERN));
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });
});

test('with node absent from PATH the commit succeeds and a warning is printed', () => {
  withRepo((dir) => {
    const empty = mkdtempSync(join(tmpdir(), 'no-node-'));
    try {
      writeFileSync(join(dir, 'note.txt'), `${TOKEN}\n`);
      mustGit(dir, 'add', 'note.txt');
      const r = commit(dir, ['-m', 'probe'], { env: { PATH: empty, CONFIDENTIAL_PATTERNS: PATTERN } });
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /node not found/);
      assert.doesNotMatch(r.out.toLowerCase(), new RegExp(PATTERN));
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

test('the gate in a bare repo with a linked worktree: no crash, no guessed path, warning, exit 0', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gate-bare-')));
  try {
    const src = join(base, 'src');
    mkdirSync(src);
    mustGit(src, 'init', '-q');
    mustGit(src, 'config', 'user.name', 'Test');
    mustGit(src, 'config', 'user.email', 'test@example.invalid');
    writeFileSync(join(src, 'README'), 'clean\n');
    mustGit(src, 'add', 'README');
    mustGit(src, 'commit', '-q', '-m', 'init');
    // Two layouts: a bare repo named like a normal git dir (`<root>/.git`, the dangerous guess)
    // and one with an ordinary name. Both have a pattern file where a guess would look.
    for (const layout of ['named-dot-git', 'plain-bare']) {
      const root = join(base, layout);
      mkdirSync(root);
      const bare = layout === 'named-dot-git' ? join(root, '.git') : join(root, 'repo.git');
      mustGit(base, 'clone', '-q', '--bare', src, bare);
      writeFileSync(join(root, '.confidential-patterns'), `${PATTERN}\n`);
      writeFileSync(join(bare, '.confidential-patterns'), `${PATTERN}\n`);
      const wt = join(root, 'wt');
      mustGit(bare, 'worktree', 'add', '-q', '-b', 'linked', wt);
      writeFileSync(join(wt, 'note.txt'), `${TOKEN}\n`);
      mustGit(wt, 'add', 'note.txt');
      const r = spawnSync(process.execPath, [GATE, '--staged'], { cwd: wt, env: cleanEnv(), encoding: 'utf8' });
      assert.equal(r.status, 0, `${layout}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /NO PATTERNS CONFIGURED/, layout);
      assert.doesNotMatch(r.stdout + r.stderr, /pattern #/, layout);
      assert.doesNotMatch((r.stdout + r.stderr).toLowerCase(), new RegExp(PATTERN), layout);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a normal repo does not fall back to a pattern file in its own parent directory', () => {
  withRepo((dir) => {
    const parentFile = join(dir, '..', '.confidential-patterns');
    // The temp parent is shared; only write when it is free, and always clean up.
    try {
      writeFileSync(parentFile, `${PATTERN}\n`, { flag: 'wx' });
    } catch {
      return;
    }
    try {
      writeFileSync(join(dir, 'note.txt'), `${TOKEN}\n`);
      mustGit(dir, 'add', 'note.txt');
      const r = commit(dir);
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /NO PATTERNS CONFIGURED/);
    } finally {
      rmSync(parentFile, { force: true });
    }
  });
});
