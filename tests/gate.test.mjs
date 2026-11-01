import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gate = resolve('scripts/gate.mjs');
const GATE_VARS = ['CONFIDENTIAL_PATTERNS', 'GATE_REQUIRED', 'CONFIDENTIAL_PATTERNS_MIN', 'CONFIDENTIAL_PATTERNS_SHA256'];
// Git variables that would point a subprocess at another repository or index.
const GIT_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR'];

/** Ten patterns that match nothing, so required mode clears the default minimum. */
const FILLER = Array.from({ length: 10 }, (_, i) => `nomatchfiller${i}zz`);
const list = (...extra) => [...extra, ...FILLER].join('\n');

function cleanEnv(dir) {
  const env = { ...process.env, GITHUB_ACTIONS: '', GIT_CEILING_DIRECTORIES: dirname(dir) };
  for (const k of [...GATE_VARS, ...GIT_VARS]) delete env[k];
  return env;
}

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, env: cleanEnv(dir), encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/**
 * A temp dir with dist/index.html (holding PlantedSecret123). By default it is a
 * git repo (`git init`, files staged, nothing committed). Never contains
 * .confidential-patterns, so the worktree's local list cannot reach a result.
 */
function fixture({ repo = true } = {}) {
  const dir = tempDir({ repo });
  writeFileSync(join(dir, 'dist', 'index.html'), '<p>hello PlantedSecret123 world</p>');
  return dir;
}

/** A temp dir with an empty dist/; a git repo (nothing staged) unless `repo` is false. */
function tempDir({ repo = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  mkdirSync(join(dir, 'dist'));
  if (repo) git(dir, '-c', 'init.defaultBranch=main', 'init', '-q');
  return dir;
}

/** Writes a file (creating parents) and stages it. */
function track(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
  git(dir, 'add', '--', path);
}

/** Runs the gate in `dir`. `overrides` sets env vars; `undefined` deletes one. */
function run(dir, patterns, overrides = {}, args = []) {
  const env = cleanEnv(dir);
  if (patterns !== undefined) env.CONFIDENTIAL_PATTERNS = patterns;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return spawnSync(process.execPath, [gate, ...args], { cwd: dir, env, encoding: 'utf8' });
}

/** Criterion 10: a content hit never prints the matched text. */
function assertNoLeak(r, text) {
  const out = `${r.stdout}\n${r.stderr}`.toLowerCase();
  assert.ok(!out.includes(text.toLowerCase()), `output leaked the matched text:\n${out}`);
}

function withFixture(opts, fn) {
  const dir = fixture(opts);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sha = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex');

// --- existing behaviour -------------------------------------------------------

test('hit fails, names the file and pattern index, not the text', () => {
  withFixture({}, (dir) => {
    const r = run(dir, '# comment\n\nplantedsecret123\n');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^dist\/index\.html: pattern #1$/m);
    assertNoLeak(r, 'plantedsecret123');
  });
});

test('no patterns passes with a warning when not required', () => {
  withFixture({}, (dir) => {
    const r = run(dir, '');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NO PATTERNS CONFIGURED/);
  });
});

test('non-matching pattern passes', () => {
  withFixture({}, (dir) => {
    const r = run(dir, 'nothingmatchesthis');
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /pattern #/);
    assert.match(r.stdout, /confidentiality gate: ok \(1 patterns/);
  });
});

test('missing dist fails with a clear message before any git call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  try {
    const r = run(dir, 'anything', { GATE_REQUIRED: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /dist\/ not found/);
    assert.doesNotMatch(r.stdout, /git/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scans files with unusual or no extension, skips binaries', () => {
  withFixture({}, (dir) => {
    writeFileSync(join(dir, 'dist', '_redirects'), '/old /plantedredirect9 301');
    writeFileSync(join(dir, 'dist', 'a.ics'), 'SUMMARY:plantedcal8');
    writeFileSync(join(dir, 'dist', 'b.png'), 'plantedpng7');
    writeFileSync(join(dir, 'dist', 'blob'), Buffer.from('plantedblob6\0\0'));
    track(dir, 'public/c.woff2', 'plantedfont4');
    for (const [pat, file] of [['plantedredirect9', '_redirects'], ['plantedcal8', 'a.ics']]) {
      const r = run(dir, pat);
      assert.equal(r.status, 1);
      assert.match(r.stdout, new RegExp(`dist/${file.replace('.', '\\.')}: pattern #1$`, 'm'));
      assertNoLeak(r, pat);
    }
    assert.equal(run(dir, 'plantedpng7').status, 0);
    assert.equal(run(dir, 'plantedblob6').status, 0);
    assert.equal(run(dir, 'plantedfont4').status, 0);
  });
});

test('anchored patterns match mid-file lines', () => {
  withFixture({}, (dir) => {
    writeFileSync(join(dir, 'dist', 'x.txt'), 'first\nplantedline5\nlast');
    const r = run(dir, '^plantedline5$');
    assert.equal(r.status, 1);
    assertNoLeak(r, 'plantedline5');
  });
});

// --- 1. fail closed ------------------------------------------------------------

test('required with no patterns fails', () => {
  withFixture({}, (dir) => {
    const r = run(dir, '', { GATE_REQUIRED: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /NO PATTERNS CONFIGURED/);
  });
});

test('GATE_REQUIRED other than exactly 1 counts as unset', () => {
  withFixture({}, (dir) => {
    for (const v of ['', 'true', ' 1', '0']) {
      const r = run(dir, '', { GATE_REQUIRED: v });
      assert.equal(r.status, 0, `GATE_REQUIRED=${JSON.stringify(v)}`);
      assert.match(r.stdout, /NO PATTERNS CONFIGURED/);
    }
  });
});

// --- 2. minimum pattern count ------------------------------------------------

test('required with fewer patterns than the minimum fails; not required warns', () => {
  withFixture({}, (dir) => {
    const short = FILLER.slice(0, 9).join('\n');
    const r = run(dir, short, { GATE_REQUIRED: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /only 9 patterns loaded, expected at least 10/);
    const w = run(dir, short);
    assert.equal(w.status, 0);
    assert.match(w.stdout, /WARNING: .*only 9 patterns/);
    assert.equal(run(dir, list(), { GATE_REQUIRED: '1' }).status, 0);
  });
});

test('CONFIDENTIAL_PATTERNS_MIN overrides the minimum; empty falls back to 10', () => {
  withFixture({}, (dir) => {
    const three = FILLER.slice(0, 3).join('\n');
    assert.equal(run(dir, three, { GATE_REQUIRED: '1', CONFIDENTIAL_PATTERNS_MIN: '3' }).status, 0);
    assert.equal(run(dir, three, { GATE_REQUIRED: '1', CONFIDENTIAL_PATTERNS_MIN: '4' }).status, 1);
    assert.equal(run(dir, three, { GATE_REQUIRED: '1', CONFIDENTIAL_PATTERNS_MIN: '' }).status, 1);
    assert.equal(run(dir, list(), { GATE_REQUIRED: '1', CONFIDENTIAL_PATTERNS_MIN: '' }).status, 0);
    assert.equal(run(dir, list(), { GATE_REQUIRED: '1', CONFIDENTIAL_PATTERNS_MIN: '11' }).status, 1);
    assert.equal(run(dir, list(), { CONFIDENTIAL_PATTERNS_MIN: 'ten' }).status, 1);
  });
});

// --- 3. fingerprint ------------------------------------------------------------

test('fingerprint mismatch fails without printing either hash; match passes; empty ignored', () => {
  withFixture({}, (dir) => {
    const lines = FILLER;
    const good = sha(lines);
    // Comments, blank lines and surrounding whitespace do not change the fingerprint.
    const raw = `# header\n\n${lines.map((l) => `  ${l} `).join('\n')}\n# trailing\n`;
    assert.equal(run(dir, raw, { CONFIDENTIAL_PATTERNS_SHA256: good }).status, 0);
    assert.equal(run(dir, raw, { CONFIDENTIAL_PATTERNS_SHA256: good.toUpperCase() }).status, 0);
    assert.equal(run(dir, raw, { CONFIDENTIAL_PATTERNS_SHA256: '' }).status, 0);

    const wrong = sha(['something else']);
    const r = run(dir, lines.slice(0, 9).join('\n'), { CONFIDENTIAL_PATTERNS_SHA256: good });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /fingerprint mismatch/);
    const m = run(dir, raw, { CONFIDENTIAL_PATTERNS_SHA256: wrong });
    assert.equal(m.status, 1);
    for (const out of [r, m]) {
      for (const h of [good, wrong, sha(lines.slice(0, 9))]) assert.ok(!out.stdout.includes(h));
      assert.doesNotMatch(out.stdout, /[0-9a-f]{64}/);
    }
  });
});

test('--fingerprint prints the count and hash and scans nothing', () => {
  withFixture({}, (dir) => {
    const r = run(dir, '# c\nplantedsecret123\n\nother\n', {}, ['--fingerprint']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^patterns: 2$/m);
    assert.match(r.stdout, new RegExp(`^sha256: ${sha(['plantedsecret123', 'other'])}$`, 'm'));
    assert.doesNotMatch(r.stdout, /pattern #|confidentiality gate/);
  });
});

// --- 4. tracked file set ----------------------------------------------------------

test('content hits in a tracked root file and a tracked workflow fail and name the path', () => {
  withFixture({}, (dir) => {
    track(dir, 'README.md', 'see plantedroot3 here');
    track(dir, '.github/workflows/ci.yml', 'name: plantedwf2');
    const pats = list('plantedroot3', 'plantedwf2');
    const r = run(dir, pats, { GATE_REQUIRED: '1' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^README\.md: pattern #1$/m);
    assert.match(r.stdout, /^\.github\/workflows\/ci\.yml: pattern #2$/m);
    assertNoLeak(r, 'plantedroot3');
    assertNoLeak(r, 'plantedwf2');
  });
});

test('an untracked, non-ignored file outside dist/ is not scanned', () => {
  withFixture({}, (dir) => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'draft.md'), 'planteduntracked1');
    const r = run(dir, list('planteduntracked1'), { GATE_REQUIRED: '1' });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /pattern #/);
  });
});

// --- 5. path hits -------------------------------------------------------------------

test('a tracked file whose name matches prints the path hit', () => {
  withFixture({}, (dir) => {
    track(dir, 'docs/plantedname0-notes.md', 'harmless');
    const r = run(dir, list('plantedname0'));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^docs\/plantedname0-notes\.md: pattern #1 \(path\)$/m);
  });
});

test('a dist/ path is matched with the dist/ prefix', () => {
  withFixture({}, (dir) => {
    mkdirSync(join(dir, 'dist', 'work', 'plantedslug'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'work', 'plantedslug', 'index.html'), 'ok');
    const r = run(dir, list('^dist/work/plantedslug/'));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^dist\/work\/plantedslug\/index\.html: pattern #1 \(path\)$/m);
  });
});

// --- 6. non-ASCII paths --------------------------------------------------------------

test('a tracked non-ASCII filename is scanned and reported with its real path', () => {
  withFixture({}, (dir) => {
    track(dir, 'src/café ñ.md', 'plantedunicode9');
    const r = run(dir, list('plantedunicode9'));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^src\/café ñ\.md: pattern #1$/m);
    assert.doesNotMatch(r.stdout, /\\303/);
    assertNoLeak(r, 'plantedunicode9');
  });
});

// --- 7. deleted, symlinked and gitlink entries ---------------------------------------

test('tracked-then-deleted files, symlinks and gitlinks do not crash the gate', () => {
  withFixture({}, (dir) => {
    track(dir, 'gone.md', 'plantedgone8');
    unlinkSync(join(dir, 'gone.md'));
    track(dir, 'gonedir/x.md', 'plantedgone8');
    rmSync(join(dir, 'gonedir'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'target.txt'), 'fine');
    symlinkSync('dist/target.txt', join(dir, 'link.txt'));
    symlinkSync('nowhere', join(dir, 'dangling.txt'));
    git(dir, 'add', '--', 'link.txt', 'dangling.txt');
    // A gitlink (submodule entry) shows up as a directory, or not at all.
    const fake = '0123456789abcdef0123456789abcdef01234567';
    mkdirSync(join(dir, 'sub'));
    git(dir, 'update-index', '--add', '--cacheinfo', `160000,${fake},sub`);
    git(dir, 'update-index', '--add', '--cacheinfo', `160000,${fake},missingsub`);
    const tracked = git(dir, 'ls-files', '-z').split('\0');
    for (const p of ['gone.md', 'link.txt', 'sub', 'missingsub']) assert.ok(tracked.includes(p), p);

    const r = run(dir, list('plantedgone8'), { GATE_REQUIRED: '1' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /confidentiality gate: ok/);
  });
});

// --- 8. .gate-allow ---------------------------------------------------------------------

test('.gate-allow: an exact entry suppresses its hit', () => {
  withFixture({}, (dir) => {
    track(dir, 'CHANGELOG.md', 'mentions plantedallow7 on purpose');
    track(dir, '.gate-allow', '# deliberate mentions\n\n1 content CHANGELOG.md # historical entry, reviewed\n');
    const r = run(dir, list('plantedallow7'), { GATE_REQUIRED: '1' });
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /1 allowed by \.gate-allow/);
    assertNoLeak(r, 'plantedallow7');
  });
});

test('.gate-allow: entries are exact in pattern, scope and path', () => {
  withFixture({}, (dir) => {
    track(dir, 'CHANGELOG.md', 'mentions plantedallow7 on purpose');
    track(dir, 'README.md', 'and plantedallow7 again');
    track(dir, '.gate-allow', '1 path CHANGELOG.md # wrong scope\n');
    const r = run(dir, list('plantedallow7'));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^CHANGELOG\.md: pattern #1$/m);
    assert.match(r.stdout, /^README\.md: pattern #1$/m);
    assert.match(r.stdout, /^\.gate-allow:1: stale entry/m);
    assertNoLeak(r, 'plantedallow7');
  });
});

test('.gate-allow: a malformed line fails and prints its line number', () => {
  withFixture({}, (dir) => {
    const bad = [
      '1 content CHANGELOG.md', // no reason
      '1 content CHANGELOG.md #', // empty reason
      '1 contents CHANGELOG.md # bad scope',
      '0 content CHANGELOG.md # zero',
      'x content CHANGELOG.md # not a number',
      '1 content .gate-allow # may not exempt itself',
    ];
    for (const line of bad) {
      track(dir, '.gate-allow', `# header\n\n${line}\n`);
      // Format is checked even with no patterns loaded.
      for (const pats of [list(), '']) {
        const r = run(dir, pats);
        assert.equal(r.status, 1, line);
        assert.match(r.stdout, /\.gate-allow:3: malformed entry/, line);
      }
    }
  });
});

test('.gate-allow: an n above the pattern count fails', () => {
  withFixture({}, (dir) => {
    track(dir, '.gate-allow', '12 content README.md # beyond the list\n');
    const r = run(dir, list());
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\.gate-allow:1: pattern #12 does not exist/);
  });
});

test('.gate-allow: a stale entry fails; with no patterns only the format is checked', () => {
  withFixture({}, (dir) => {
    track(dir, 'README.md', 'nothing here');
    track(dir, '.gate-allow', '1 content README.md # was a mention\n');
    const r = run(dir, list('plantedstale6'));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^\.gate-allow:1: stale entry/m);
    const none = run(dir, '');
    assert.equal(none.status, 0);
    assert.match(none.stdout, /NO PATTERNS CONFIGURED/);
  });
});

test('.gate-allow: a path entry suppresses a path hit and is not stale', () => {
  withFixture({}, (dir) => {
    track(dir, 'docs/plantedname0.md', 'harmless');
    track(dir, '.gate-allow', '1 path docs/plantedname0.md # renamed in a follow-up\n');
    const r = run(dir, list('plantedname0'));
    assert.equal(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /stale|pattern #/);
  });
});

test('.gate-allow is scanned itself: a reason quoting matched text fails', () => {
  withFixture({}, (dir) => {
    track(dir, 'README.md', 'mentions plantedquote4');
    track(dir, '.gate-allow', '1 content README.md # it says plantedquote4\n');
    const r = run(dir, list('plantedquote4'));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^\.gate-allow: pattern #1$/m);
    assertNoLeak(r, 'plantedquote4');
    track(dir, '.gate-allow', '# plantedquote4 in a comment\n1 content README.md # reviewed mention\n');
    assert.equal(run(dir, list('plantedquote4')).status, 1);
    track(dir, '.gate-allow', '1 content README.md # reviewed mention\n');
    assert.equal(run(dir, list('plantedquote4')).status, 0);
  });
});

// --- 9. not a git repository ----------------------------------------------------------

test('outside a git repo: warns, scans dist/ only; required fails', () => {
  withFixture({ repo: false }, (dir) => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'x.md'), 'plantedoutside5');
    const r = run(dir, list('plantedoutside5'));
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /not a git repository, only dist\/ was scanned/);
    assert.doesNotMatch(r.stdout, /pattern #/);
    const d = run(dir, list('plantedsecret123'));
    assert.equal(d.status, 1);
    assert.match(d.stdout, /^dist\/index\.html: pattern #1$/m);
    assertNoLeak(d, 'plantedsecret123');
    const req = run(dir, list('plantedoutside5'), { GATE_REQUIRED: '1' });
    assert.equal(req.status, 1);
    assert.match(req.stdout, /not a git repository/);
  });
});

test('git missing from PATH counts as no git', () => {
  withFixture({}, (dir) => {
    const r = run(dir, list(), { PATH: '/nonexistent' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /only dist\/ was scanned/);
    assert.equal(run(dir, list(), { PATH: '/nonexistent', GATE_REQUIRED: '1' }).status, 1);
  });
});

// --- dedupe -------------------------------------------------------------------------------

test('a tracked file under dist/ is reported once', () => {
  withFixture({}, (dir) => {
    git(dir, 'add', '--', 'dist/index.html');
    const r = run(dir, list('plantedsecret123'));
    assert.equal(r.status, 1);
    assert.equal(r.stdout.match(/dist\/index\.html: pattern #1/g).length, 1);
  });
});

/**
 * A minimal, uncompressed one-page PDF built by hand: `lines` of Helvetica text (each on its
 * own line), an optional Info /Title and an optional /URI link annotation. Planted strings only.
 */
function pdf({ lines = [], title, uri } = {}) {
  const esc = (s) => s.replace(/[\\()]/g, '\\$&');
  const content = `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((l, i) => `${i ? 'T* ' : ''}(${esc(l)}) Tj`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R${uri ? ' /Annots [6 0 R]' : ''} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  if (uri) objs.push(`<< /Type /Annot /Subtype /Link /Rect [72 600 300 620] /Border [0 0 0] /A << /S /URI /URI (${esc(uri)}) >> >>`);
  const info = title ? objs.push(`<< /Title (${esc(title)}) >>`) : 0;
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A tree whose dist/ holds a clean page and one PDF. */
function pdfFixture(name, bytes) {
  const dir = tempDir();
  writeFileSync(join(dir, 'dist', 'index.html'), '<p>clean</p>');
  writeFileSync(join(dir, 'dist', `${name}.pdf`), bytes);
  return dir;
}

const PDF_HITS = [
  ['text', 'a', { lines: ['before PlantedSecret123 after'] }, 'plantedsecret123'],
  ['a phrase split across two lines', 'b', { lines: ['intro PlantedFirst', 'PlantedSecond outro'] }, 'plantedfirst plantedsecond'],
  ['Info /Title only', 'c', { lines: ['clean text'], title: 'PlantedTitle456' }, 'plantedtitle456'],
  ['a /URI link annotation only', 'd', { lines: ['clean text'], uri: 'https://plantedlink789.example/x' }, 'plantedlink789'],
];

for (const [what, name, spec, pattern] of PDF_HITS) {
  test(`PDF: a planted string in ${what} fails, names the file, not the text`, () => {
    const dir = pdfFixture(name, pdf(spec));
    try {
      const r = run(dir, pattern);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`dist[\\\\/]${name}\\.pdf: pattern #1`));
      for (const word of pattern.split(' ')) assert.doesNotMatch((r.stdout + r.stderr).toLowerCase(), new RegExp(word));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('PDF: an unparseable .pdf fails closed as an unreadable PDF', () => {
  const dir = pdfFixture('e', Buffer.from('%PDF-1.4\nnot really a pdf\n'));
  try {
    const r = run(dir, 'nothingmatchesthis');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /dist[\\/]e\.pdf: unreadable PDF/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PDF: a clean PDF passes, and its text really is read', () => {
  const dir = pdfFixture('clean', pdf({ lines: ['nothing to see', 'here either'], title: 'Clean title', uri: 'https://example.com/' }));
  try {
    const r = run(dir, 'plantedsecret123');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /pattern #|unreadable/);
    // The same file does hit on its own words, so passing means clean, not unread.
    assert.equal(run(dir, 'nothing to see').status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The tracked example denylist (.confidential-patterns.example). Every case below runs the real
// gate; none reads or writes the repo-root `.confidential-patterns`. Fallback cases use mkdtemp
// fixtures, and the repo-root case overrides the file through the env var.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLE = readFileSync(join(ROOT, '.confidential-patterns.example'), 'utf8');
const PLAIN_PATTERN = 'vrelk[a]nthum';
// Built, not written out: the gate scans this tracked file, and the literal would hit the example.
const PLAIN_TOKEN = ['vrelk', 'anthum'].join('');
const ANCHORED_PATTERN = '^snorv[e]lt-quill$';
const ANCHORED_TOKEN = 'snorvelt-quill';
const INVALID_LINE = '(unclosed[group';

const rootGit = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/** A fixture whose `.confidential-patterns` holds `fileText` and whose index.html holds `html`. */
function fileFixture(fileText, html) {
  const dir = tempDir();
  writeFileSync(join(dir, 'dist', 'index.html'), html);
  writeFileSync(join(dir, '.confidential-patterns'), fileText);
  return dir;
}

function assertFallbackHit(r) {
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /dist[\\/]index\.html: pattern #1/);
  assert.doesNotMatch((r.stdout + r.stderr).toLowerCase(), new RegExp(PLAIN_TOKEN));
}

test('example: is tracked, its sibling real file is not, and the ignore rule spares it', () => {
  assert.equal(rootGit('ls-files', '.confidential-patterns.example').stdout.trim(), '.confidential-patterns.example');
  assert.equal(rootGit('ls-files', '.confidential-patterns').stdout.trim(), '');
  assert.equal(rootGit('check-ignore', '-q', '.confidential-patterns.example').status, 1, 'the example is ignored');
});

test('example: holds the documented patterns and keeps the invalid one commented out', () => {
  const active = EXAMPLE.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(active, [PLAIN_PATTERN, ANCHORED_PATTERN]);
  assert.ok(EXAMPLE.split(/\r?\n/).includes(`# ${INVALID_LINE}`), 'invalid example is not a commented line');
  // Each pattern uses the character-class trick: it does not match its own source text.
  for (const p of active) assert.ok(!new RegExp(p, 'im').test(p), `${p} matches itself`);
});

test('README names the example and starts a local file without overwriting one', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /cp -n \.confidential-patterns\.example \.confidential-patterns/);
});

test('fallback: env unset reads .confidential-patterns', () => {
  const dir = fileFixture(EXAMPLE, `<p>x ${PLAIN_TOKEN} y</p>`);
  try {
    assertFallbackHit(run(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fallback: a whitespace-only env also reads .confidential-patterns', () => {
  const dir = fileFixture(EXAMPLE, `<p>x ${PLAIN_TOKEN} y</p>`);
  try {
    assertFallbackHit(run(dir, '  \n\t '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fallback: env unset and no file still warns and passes', () => {
  const dir = fixture();
  try {
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NO PATTERNS CONFIGURED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('precedence: a non-blank env wins over .confidential-patterns', () => {
  const dir = fileFixture(EXAMPLE, `<p>x ${PLAIN_TOKEN} y</p>`);
  try {
    const r = run(dir, 'nothingmatchesthis');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /pattern #/);
    assert.match(r.stdout, /ok \(1 patterns/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('anchored hit reports its index among active patterns, not its file line', () => {
  const file = `# header\n\n# note\nnothingmatchesone\n\n# more\nnothingmatchestwo\n# end\n${ANCHORED_PATTERN}\n`;
  const fileLine = file.split('\n').indexOf(ANCHORED_PATTERN) + 1;
  assert.notEqual(fileLine, 3);
  const dir = fileFixture(file, '<p>clean</p>');
  try {
    writeFileSync(join(dir, 'dist', 'x.txt'), `first\n${ANCHORED_TOKEN}\nlast`);
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /dist[\\/]x\.txt: pattern #3\b/);
    assert.doesNotMatch(r.stdout, new RegExp(`pattern #${fileLine}\\b`));
    assert.doesNotMatch(r.stdout.toLowerCase(), new RegExp(ANCHORED_TOKEN));
    // Anchored means the whole line: the token inside a longer line does not hit.
    writeFileSync(join(dir, 'dist', 'x.txt'), `first\nsay ${ANCHORED_TOKEN} twice\nlast`);
    assert.equal(run(dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid regex: the uncommented example line fails and is not printed', () => {
  const marked = EXAMPLE.replace(`# ${INVALID_LINE}`, INVALID_LINE);
  assert.notEqual(marked, EXAMPLE);
  const dir = fileFixture(marked, '<p>clean</p>');
  try {
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /pattern #3: invalid regular expression/);
    assert.doesNotMatch(r.stdout + r.stderr, /unclosed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no self-match: the example text inside dist/ passes with the example as the pattern file', () => {
  const dir = fileFixture(EXAMPLE, EXAMPLE);
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ok \(2 patterns, \d+ files, no hits\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no false positives: the example finds nothing in the real dist/ and tracked files', () => {
  // cwd is the repo root; the env var overrides the local file, which is never read or written.
  const r = run(ROOT, EXAMPLE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok \(2 patterns, \d+ files, no hits\)/);
});

// Second pass (#108): synthetic text only, written with escapes so the code points are visible.
function distWith(content) {
  const dir = tempDir();
  writeFileSync(join(dir, 'dist', 'index.html'), content);
  return dir;
}

function runOn(content, patterns) {
  const dir = distWith(content);
  try {
    return run(dir, patterns);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertHit(r) {
  assert.equal(r.status, 1);
  assert.match(r.stdout, /dist[\\/]index\.html: pattern #1\n/);
  assert.match(r.stdout, /FAILED, 1 hit\(s\)/);
}

test('normalised pass: a straight apostrophe pattern hits the HTML-encoded form', () => {
  assertHit(runOn("<p>Plant&#39;ed Secret</p>", "plant'ed secret"));
  assertHit(runOn("<p>Plant&#x27;ed Secret</p>", "plant'ed secret"));
});

test('normalised pass: a straight apostrophe pattern hits a curly apostrophe', () => {
  assertHit(runOn('<p>Plant\u2019ed Secret</p>', "plant'ed secret"));
});

test('normalised pass: a straight quote pattern hits &quot;', () => {
  assertHit(runOn('<p>the &quot;Planted Secret&quot;</p>', '"planted secret"'));
});

test('normalised pass: an NFC pattern hits an NFD file', () => {
  const nfc = 'Zo\u00eb Example'.normalize('NFC');
  const nfd = 'Zo\u00eb Example'.normalize('NFD');
  assertHit(runOn(`<p>${nfd}</p>`, nfc));
});

test('normalised pass: an unaccented pattern hits the accented spelling', () => {
  assertHit(runOn('<p>Zo\u00eb Example</p>', 'zoe example'));
});

test('normalised pass: a one-space pattern hits two words split across a line break', () => {
  assertHit(runOn('<p>Planted\n      Secret</p>', 'planted secret'));
});

test('normalised pass: an ASCII hyphen pattern hits an en dash', () => {
  assertHit(runOn('<p>Planted\u2013Secret</p>', 'planted-secret'));
});

test('hostile numeric entities do not crash the gate', () => {
  const r = runOn('<p>&#99999999; &#x110000; &#xD800; &#0;</p>', 'nothingmatchesthis');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /confidentiality gate: ok/);
});

test('a file that hits in both passes is reported once, counted as 1', () => {
  assertHit(runOn('<p>PlantedSecret123</p>', 'plantedsecret123'));
});

test('a pattern whose folded form is invalid fails closed without printing it', () => {
  const dir = distWith('<p>nothing here</p>');
  try {
    const r = run(dir, 'Plant\uff08ed');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /pattern #1: folded form invalid/);
    assert.doesNotMatch(r.stdout, /Plant/i);
    assert.doesNotMatch(r.stdout, /confidentiality gate: ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a raw-invalid pattern keeps its own message', () => {
  const r = runOn('<p>x</p>', 'plant(ed');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /pattern #1: invalid regular expression/);
});

test('anchored patterns still hit a mid-file line through the raw pass', () => {
  assertHit(runOn('alpha\nbeta line\ngamma\n', '^beta line$'));
});
