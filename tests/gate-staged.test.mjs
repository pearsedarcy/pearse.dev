// `node scripts/gate.mjs --staged` scans the git index. Every case builds a throwaway repo under
// os.tmpdir() and uses a synthetic token only; the real denylist is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const gate = resolve('scripts/gate.mjs');
const TOKEN = 'PlantedSecret123';
const PATTERN = 'plantedsecret123';

/** A child env with nothing from the host: no GIT_* (set inside a hook), no patterns, no config. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, GITHUB_ACTIONS: '' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  delete env.CONFIDENTIAL_PATTERNS;
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return { ...env, ...extra };
}

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A temp repo with an identity; `commit` makes an initial commit so HEAD exists. */
function repo({ commit = false } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-staged-')));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  if (commit) {
    writeFileSync(join(dir, 'README'), 'clean\n');
    git(dir, 'add', 'README');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

function run(dir, { patterns, args = ['--staged'], cwd = dir } = {}) {
  const env = cleanEnv();
  if (patterns !== undefined) env.CONFIDENTIAL_PATTERNS = patterns;
  return spawnSync(process.execPath, [gate, ...args], { cwd, env, encoding: 'utf8' });
}

function withRepo(opts, fn) {
  const dir = repo(opts);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a staged token fails, names the repo-relative path and pattern, never the token', () => {
  withRepo({}, (dir) => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'note.txt'), `hello ${TOKEN}\n`);
    git(dir, 'add', 'sub/note.txt');
    const r = run(dir, { patterns: `# c\n\nnomatch\n${PATTERN}\n` });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^sub\/note\.txt: pattern #2$/m);
    assert.match(r.stdout, /FAILED, 1 hit/);
    assert.doesNotMatch(r.stdout.toLowerCase(), new RegExp(PATTERN));
  });
});

test('staged then removed from disk without restaging still fails (index, not disk)', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'a.txt'), `${TOKEN}\n`);
    git(dir, 'add', 'a.txt');
    writeFileSync(join(dir, 'a.txt'), 'clean now\n');
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^a\.txt: pattern #1$/m);
  });
});

test('a token only in an unstaged working-tree edit passes', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'a.txt'), 'clean\n');
    git(dir, 'add', 'a.txt');
    writeFileSync(join(dir, 'a.txt'), `clean\n${TOKEN}\n`);
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /pattern #/);
  });
});

test('a staged modification against HEAD is scanned', () => {
  withRepo({ commit: true }, (dir) => {
    writeFileSync(join(dir, 'README'), `clean\n${TOKEN}\n`);
    git(dir, 'add', 'README');
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^README: pattern #1$/m);
  });
});

test('a staged rename is scanned under its new path', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'old.txt'), `line one\nline two\nline three\n${TOKEN}\n`);
    git(dir, 'add', 'old.txt');
    git(dir, 'commit', '-q', '-m', 'old');
    git(dir, 'mv', 'old.txt', 'new.txt');
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^new\.txt: pattern #1$/m);
    assert.doesNotMatch(r.stdout, /old\.txt/);
  });
});

test('a staged deletion is ignored', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'a.txt'), `${TOKEN}\n`);
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'add');
    git(dir, 'rm', '-q', 'a.txt');
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /nothing staged/);
  });
});

test('paths with a space and with a newline each print on one line, the newline escaped', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'a b.txt'), `${TOKEN}\n`);
    writeFileSync(join(dir, 'x\ny.txt'), `${TOKEN}\n`);
    git(dir, 'add', '--', 'a b.txt', 'x\ny.txt');
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 1);
    const lines = r.stdout.split('\n');
    assert.ok(lines.includes('a b.txt: pattern #1'), r.stdout);
    assert.ok(lines.includes('x\\ny.txt: pattern #1'), r.stdout);
    assert.equal(lines.filter((l) => l.includes('pattern #')).length, 2);
    assert.match(r.stdout, /FAILED, 2 hit/);
  });
});

test('a path with a Unicode line separator is escaped too', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'p\u2028q.txt'), `${TOKEN}\n`);
    git(dir, 'add', '--', 'p\u2028q.txt');
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 1);
    assert.ok(r.stdout.split('\n').includes('p\\u2028q.txt: pattern #1'), r.stdout);
  });
});

test('a NUL-containing blob and a binary extension are skipped', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'data.dat'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(TOKEN)]));
    writeFileSync(join(dir, 'pic.png'), TOKEN);
    git(dir, 'add', 'data.dat', 'pic.png');
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /pattern #/);
  });
});

test('a staged .pdf is read as a PDF and fails closed when unreadable', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'broken.pdf'), 'not a pdf at all');
    git(dir, 'add', 'broken.pdf');
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^broken\.pdf: unreadable PDF$/m);
  });
});

test('a staged symlink is skipped and a gitlink does not crash the gate', () => {
  withRepo({}, (dir) => {
    symlinkSync(`${TOKEN}-target`, join(dir, 'link'));
    git(dir, 'add', 'link');
    git(dir, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},sub`);
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /pattern #/);
  });
});

test('from a subdirectory it reads the top-level pattern file and prints top-level paths', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, '.confidential-patterns'), `${PATTERN}\n`);
    mkdirSync(join(dir, 'deep', 'er'), { recursive: true });
    writeFileSync(join(dir, 'deep', 'er', 'f.txt'), `${TOKEN}\n`);
    git(dir, 'add', 'deep/er/f.txt');
    const r = run(dir, { cwd: join(dir, 'deep', 'er') });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^deep\/er\/f\.txt: pattern #1$/m);
  });
});

test('env patterns win over the top-level file; a blank env falls back to it', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, '.confidential-patterns'), `${PATTERN}\n`);
    writeFileSync(join(dir, 'a.txt'), `${TOKEN}\n`);
    git(dir, 'add', 'a.txt');
    assert.equal(run(dir, { patterns: 'nomatch' }).status, 0);
    assert.equal(run(dir, { patterns: '  ' }).status, 1);
  });
});

test('nothing staged exits 0 with a one-line ok message and needs no dist/', () => {
  withRepo({ commit: true }, (dir) => {
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.match(r.stdout, /nothing staged/);
    assert.doesNotMatch(r.stdout, /dist/);
  });
});

test('no patterns configured exits 0 with the loud warning', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'a.txt'), `${TOKEN}\n`);
    git(dir, 'add', 'a.txt');
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NO PATTERNS CONFIGURED/);
  });
});

test('an invalid regular expression exits 1 with the existing message', () => {
  withRepo({}, (dir) => {
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    git(dir, 'add', 'a.txt');
    const r = run(dir, { patterns: 'fine\n(' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^pattern #2: invalid regular expression$/m);
  });
});

test('outside a git work tree it exits 1 with a clear message', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-staged-nogit-')));
  try {
    const r = run(dir, { patterns: PATTERN });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /--staged needs a git work tree/);
    assert.equal(r.stdout.trim().split('\n').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extra arguments are refused in staged mode', () => {
  withRepo({}, (dir) => {
    const r = run(dir, { patterns: PATTERN, args: ['--staged', 'src'] });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /takes no other arguments/);
  });
});
