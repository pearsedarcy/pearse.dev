#!/usr/bin/env node
/**
 * Confidentiality gate (ADR 0005). Scans dist/, src/ and docs/ (relative to the
 * current directory) for patterns that must never ship.
 *
 * Patterns: one regex per line, blank lines and `#` comments ignored, read from
 * env CONFIDENTIAL_PATTERNS or, if unset/blank, the untracked file
 * .confidential-patterns. Matching is case-insensitive and multiline (^ and $ match per line).
 * Each file is tested twice per pattern (#108): raw, and a normalised copy of the text (entities
 * decoded, NFKC, marks stripped, typographic quotes and dashes folded, whitespace collapsed to
 * one space) against the folded pattern (scripts/gate-normalise.mjs). A pair that hits in either
 * pass is reported once. The normalised text has no line breaks, so `^`/`$` anchors only work in
 * the raw pass. A pattern whose folded form does not compile prints
 * `pattern #<n>: folded form invalid` and exits 1 before anything is scanned.
 * Every file is scanned except known binary extensions and NUL-containing files. A `.pdf` is
 * read with pdfjs-dist (scripts/pdf-text.mjs, loaded only when a PDF is found) and every pattern
 * is tested against its page text, the text with whitespace collapsed, the text with whitespace
 * removed, every Info dictionary value, the raw XMP and every link annotation target. A PDF that
 * cannot be parsed, or pdfjs-dist failing to load, prints `<file>: unreadable PDF` and fails.
 *
 * On a hit: prints `<file>: pattern #<n>` (never the matched text), exits 1.
 * With no patterns: prints a loud warning and exits 0.
 *
 * `--staged` (npm run gate -- --staged) scans the git index instead: the blob of every staged
 * regular file (added, copied, modified, renamed, type-changed), not the working tree, so a
 * partial `git add -p` is judged on what will be committed. No dist/ is needed. Symlinks and
 * gitlinks are skipped. Patterns: env first, then `.confidential-patterns` at the repository top
 * level, then (#127) `.confidential-patterns` at the main worktree root, used only when the git
 * common dir is exactly `<root>/.git` and `<root>` is not this top level, so an agent's linked
 * worktree finds the main checkout's gitignored file. A bare repo, a separate git dir or any
 * rev-parse failure gets no fallback and no guess. A hit prints `<repo-relative path>: pattern #<n>`, with control characters in the path escaped.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { readPdf, scanStrings } from './pdf-text.mjs';
import { BINARY_EXT, isBinary } from './binary-files.mjs';
import { foldPattern, normalise } from './gate-normalise.mjs';

const ROOTS = ['dist', 'src', 'docs'];
const PATTERN_FILE = '.confidential-patterns';

/** Pattern lines of one raw text: blank lines and `#` comments dropped. */
function parsePatterns(raw) {
  const out = [];
  raw.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (t && !t.startsWith('#')) out.push(t);
  });
  return out;
}

/**
 * Pattern lines: env CONFIDENTIAL_PATTERNS first (used whenever it is not blank), then each of
 * `files` in order. The first file that exists and yields at least one pattern wins; a missing or
 * comment-only file falls through to the next. With one file this is the original behaviour.
 */
function loadPatterns(...files) {
  const env = process.env.CONFIDENTIAL_PATTERNS ?? '';
  if (env.trim()) return parsePatterns(env);
  for (const file of files) {
    if (!existsSync(file)) continue;
    const found = parsePatterns(readFileSync(file, 'utf8'));
    if (found.length) return found;
  }
  return [];
}

/** The loud no-patterns warning; the caller exits 0. */
function warnNoPatterns(checkedMain = false) {
  const msg =
    'confidentiality gate: NO PATTERNS CONFIGURED, nothing was checked. ' +
    'Set the CONFIDENTIAL_PATTERNS secret or create .confidential-patterns' +
    (checkedMain ? ' (the main worktree was also checked).' : '.');
  console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `WARNING: ${msg}`);
}

/**
 * Compile every pattern up front, raw and folded, as `{ raw, folded }`. An invalid pattern is
 * printed by index (never its text) and exits 1: the raw form first, then its folded form.
 */
function compilePatterns(sources) {
  const patterns = [];
  for (const [i, p] of sources.entries()) {
    let raw;
    try {
      raw = new RegExp(p, 'im');
    } catch {
      console.log(`pattern #${i + 1}: invalid regular expression`);
      process.exit(1);
    }
    let folded;
    try {
      folded = new RegExp(foldPattern(p), 'im');
    } catch {
      console.log(`pattern #${i + 1}: folded form invalid`);
      process.exit(1);
    }
    patterns.push({ raw, folded });
  }
  return patterns;
}

/**
 * Test `texts` (one file's strings) against every pattern in both passes and print one line per
 * pattern that hits in either. The normalised copies are computed once, not once per pattern.
 * Returns the number of hits.
 */
function scanTexts(label, texts, patterns) {
  const normalised = texts.map((t) => normalise(String(t)));
  let hits = 0;
  patterns.forEach(({ raw, folded }, i) => {
    if (texts.some((t) => raw.test(t)) || normalised.some((t) => folded.test(t))) {
      hits++;
      console.log(`${label}: pattern #${i + 1}`);
    }
  });
  return hits;
}

/**
 * Test one file's bytes against every pattern and print one line per hit. `label` is the text
 * printed for the file. Returns the number of hits. A `.pdf` is routed by extension before the
 * NUL-byte check: it is binary but carries text.
 */
async function scanBuffer(path, label, buf, patterns) {
  if (extname(path).toLowerCase() === '.pdf') {
    let fields;
    try {
      fields = scanStrings(await readPdf(buf));
    } catch {
      console.log(`${label}: unreadable PDF`);
      return 1;
    }
    return scanTexts(label, fields, patterns);
  }
  if (isBinary(buf)) return 0;
  return scanTexts(label, [buf.toString('utf8')], patterns);
}

function finish(hits) {
  if (hits) {
    console.log(`confidentiality gate: FAILED, ${hits} hit(s)`);
    process.exit(1);
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!BINARY_EXT.has(extname(p).toLowerCase())) out.push(p);
  }
  return out;
}

async function scanTree() {
  if (!existsSync('dist')) {
    console.log('confidentiality gate: dist/ not found, run the build first');
    process.exit(1);
  }

  const raw = loadPatterns(PATTERN_FILE);
  if (raw.length === 0) {
    warnNoPatterns();
    process.exit(0);
  }
  const patterns = compilePatterns(raw);

  let hits = 0;
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      hits += await scanBuffer(file, file, readFileSync(file), patterns);
    }
  }

  finish(hits);
  console.log(`confidentiality gate: ok (${patterns.length} patterns, no hits)`);
}

/** Run git, return stdout as a Buffer; throws when git fails. stderr is dropped. */
function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 1 << 30,
  });
}

/** One line per path: control characters, and the Unicode line separators, are escaped. */
function escapePath(p) {
  return p.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => {
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

/**
 * Staged regular files as `{ path, sha }`. `git diff --cached --raw -z` compares the index with
 * HEAD (the empty tree before the first commit). `--no-renames` turns a rename into an add, so
 * every entry carries exactly one path. Modes other than 100644/100755 (symlink 120000, gitlink
 * 160000) are dropped before any blob is read.
 */
function stagedFiles(top) {
  const out = git(
    ['diff', '--cached', '--raw', '-z', '--full-index', '--no-renames', '--no-ext-diff', '--diff-filter=ACMRT'],
    top,
  ).toString('utf8');
  const tokens = out.split('\0');
  const files = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    // ":<oldmode> <newmode> <oldsha> <newsha> <status>", then the path.
    const m = /^:(\d+) (\d+) [0-9a-f]+ ([0-9a-f]+) [A-Z]\d*$/.exec(tokens[i]);
    if (!m) continue;
    if (m[2] !== '100644' && m[2] !== '100755') continue;
    files.push({ path: tokens[i + 1], sha: m[3] });
  }
  return files;
}

/**
 * The main worktree's pattern file for a linked worktree, or null. Only when the git common dir
 * is exactly `<root>/.git`, the repository is not bare, and `<root>` is not `top`. Anything else
 * (bare repo, separate git dir, unusual GIT_DIR, rev-parse failing) returns null: no guessing.
 */
function mainWorktreePatternFile(top) {
  try {
    const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], top)
      .toString('utf8')
      .replace(/\r?\n$/, '');
    if (!common || basename(common) !== '.git') return null;
    if (git(['config', '--bool', 'core.bare'], top).toString('utf8').trim() === 'true') return null;
    const root = dirname(common);
    if (realpathSync(root) === realpathSync(top)) return null;
    return join(root, PATTERN_FILE);
  } catch {
    return null;
  }
}

async function scanStaged() {
  if (process.argv.length > 3) {
    console.log('confidentiality gate: --staged takes no other arguments');
    process.exit(1);
  }
  let top;
  try {
    top = git(['rev-parse', '--show-toplevel'], process.cwd()).toString('utf8').replace(/\r?\n$/, '');
  } catch {
    console.log('confidentiality gate: --staged needs a git work tree, none found here');
    process.exit(1);
  }

  const mainFile = mainWorktreePatternFile(top);
  const raw = loadPatterns(join(top, PATTERN_FILE), ...(mainFile ? [mainFile] : []));
  if (raw.length === 0) {
    warnNoPatterns(mainFile !== null);
    process.exit(0);
  }
  const patterns = compilePatterns(raw);

  let files;
  try {
    files = stagedFiles(top);
  } catch {
    console.log('confidentiality gate: could not read the git index');
    process.exit(1);
  }
  if (files.length === 0) {
    console.log('confidentiality gate: nothing staged, ok');
    return;
  }

  let hits = 0;
  for (const { path, sha } of files) {
    if (BINARY_EXT.has(extname(path).toLowerCase())) continue;
    let buf;
    try {
      buf = git(['cat-file', 'blob', sha], top);
    } catch {
      console.log(`${escapePath(path)}: unreadable index entry`);
      hits++;
      continue;
    }
    hits += await scanBuffer(path, escapePath(path), buf, patterns);
  }

  finish(hits);
  console.log(`confidentiality gate: ok (${patterns.length} patterns, ${files.length} staged file(s), no hits)`);
}

if (process.argv[2] === '--staged') await scanStaged();
else await scanTree();
