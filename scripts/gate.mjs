#!/usr/bin/env node
/**
 * Confidentiality gate (ADR 0005 and its amendment). Run from the repository root.
 *
 * Tree mode (the default, `npm run gate`) scans every tracked file (`git ls-files -z`) plus the
 * gitignored build output in dist/. Each pattern is tested against each file's content and
 * against its relative path (forward slashes, `dist/...` for build output). Tracked entries that
 * are missing on disk, symlinks and gitlinks are skipped. When git is unavailable or this is not
 * a repository, only dist/ is scanned, with a warning (exit 1 in required mode).
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
 * Every file's content is scanned except known binary extensions and NUL-containing files. A `.pdf` is
 * read with pdfjs-dist (scripts/pdf-text.mjs, loaded only when a PDF is found) and every pattern
 * is tested against its page text, the text with whitespace collapsed, the text with whitespace
 * removed, every Info dictionary value, the raw XMP and every link annotation target. A PDF that
 * cannot be parsed, or pdfjs-dist failing to load, prints `<file>: unreadable PDF` and fails.
 *
 * Environment (an empty value always means unset):
 *   GATE_REQUIRED=1               fail closed: no patterns, too few patterns or no git => exit 1
 *   CONFIDENTIAL_PATTERNS_MIN     minimum pattern count (default MIN_PATTERNS), enforced when required
 *   CONFIDENTIAL_PATTERNS_SHA256  sha256 hex of the normalised list; a mismatch exits 1
 * Not required, no patterns: a loud warning and exit 0.
 *
 * Output: a content hit prints `<path>: pattern #<n>` (never the matched text); a path hit prints
 * `<path>: pattern #<n> (path)`. Deliberate mentions are listed in the committed `.gate-allow`
 * file: `<n> <content|path> <exact relative path> # <reason>`. A malformed entry, or one that
 * matches no raw hit (stale), exits 1.
 *
 * `--fingerprint` prints the pattern count and the fingerprint of the loaded list and exits 0.
 *
 * `--staged` (npm run gate -- --staged) scans the git index instead: the blob of every staged
 * regular file (added, copied, modified, renamed, type-changed), not the working tree, so a
 * partial `git add -p` is judged on what will be committed. No dist/ is needed. Symlinks and
 * gitlinks are skipped. Paths are matched too, and the staged `.gate-allow` suppresses its
 * entries; staleness is not judged, because only part of the tree is scanned. Patterns: env
 * first, then `.confidential-patterns` at the repository top
 * level, then (#127) `.confidential-patterns` at the main worktree root, used only when the git
 * common dir is exactly `<root>/.git` and `<root>` is not this top level, so an agent's linked
 * worktree finds the main checkout's gitignored file. A bare repo, a separate git dir or any
 * rev-parse failure gets no fallback and no guess. A hit prints `<repo-relative path>: pattern #<n>`, with control characters in the path escaped.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { readPdf, scanStrings } from './pdf-text.mjs';
import { BINARY_EXT, isBinary } from './binary-files.mjs';
import { foldPattern, normalise } from './gate-normalise.mjs';

/** Default minimum pattern count in required mode (truncation guard). */
const MIN_PATTERNS = 10;
const PATTERN_FILE = '.confidential-patterns';
const ALLOW_FILE = '.gate-allow';

const env = (name) => (process.env[name] ?? '').trim();
const required = process.env.GATE_REQUIRED === '1';

function fail(msg) {
  console.log(`confidentiality gate: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  const text = `confidentiality gate: ${msg}`;
  console.log(process.env.GITHUB_ACTIONS ? `::warning::${text}` : `WARNING: ${text}`);
}

/** Pattern lines of one raw text: blank lines and `#` comments dropped, trimmed. Also the fingerprinted form. */
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
  const fromEnv = process.env.CONFIDENTIAL_PATTERNS ?? '';
  if (fromEnv.trim()) return parsePatterns(fromEnv);
  for (const file of files) {
    if (!existsSync(file)) continue;
    const found = parsePatterns(readFileSync(file, 'utf8'));
    if (found.length) return found;
  }
  return [];
}

function fingerprint(list) {
  return createHash('sha256').update(list.join('\n')).digest('hex');
}

function minPatterns() {
  const v = env('CONFIDENTIAL_PATTERNS_MIN');
  if (!v) return MIN_PATTERNS;
  if (!/^\d+$/.test(v)) fail('CONFIDENTIAL_PATTERNS_MIN is not a whole number');
  return Number(v);
}

/**
 * The list-level checks, before any compile or scan. No patterns: exit 1 when required, else a
 * loud warning and exit 0. Below the minimum: exit 1 when required, else a warning (not in
 * `--staged` mode, so a commit with a short local list stays quiet). A set
 * fingerprint that does not match: exit 1 without printing either hash (it would help forge a
 * truncated list).
 */
function checkList(raw, { staged = false, checkedMain = false } = {}) {
  const min = minPatterns();
  if (raw.length === 0) {
    const msg =
      'NO PATTERNS CONFIGURED, nothing was checked. ' +
      'Set the CONFIDENTIAL_PATTERNS secret or create .confidential-patterns' +
      (checkedMain ? ' (the main worktree was also checked).' : '.');
    if (required) fail(`FAILED, ${msg} (GATE_REQUIRED=1)`);
    warn(msg);
    process.exit(0);
  }
  if (raw.length < min) {
    const msg = `only ${raw.length} patterns loaded, expected at least ${min}; the list may be truncated`;
    if (required) fail(`FAILED, ${msg} (GATE_REQUIRED=1)`);
    if (!staged) warn(msg);
  }
  const expected = env('CONFIDENTIAL_PATTERNS_SHA256').toLowerCase();
  if (expected && fingerprint(raw) !== expected) fail('FAILED, fingerprint mismatch');
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
 * Parse `.gate-allow` text (null: no file). Exits 1 on a malformed line, or on an `n` above the
 * pattern count when patterns are loaded (with none, only the format is checked).
 *
 * Returns the entries and the file's text for its own content scan, with each entry's path field
 * removed: a path entry has to spell out the matched path, which is a tracked or deployed name
 * and already public. Comments and reasons are still scanned, so a reason that quotes matched
 * text fails the gate.
 */
function parseAllow(text, patternCount) {
  if (text === null) return { entries: [], scanText: null };
  const entries = [];
  const LINE = /^([1-9]\d*)\s+(content|path)\s+(\S(?:.*?\S)?)\s+#\s*(\S.*)$/;
  const scanLines = text.split(/\r?\n/).map((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    const m = LINE.exec(t);
    // The allow file may not exempt itself: its reasons must never quote matched text.
    if (!m || m[3] === ALLOW_FILE) fail(`${ALLOW_FILE}:${i + 1}: malformed entry`);
    const n = Number(m[1]);
    if (patternCount > 0 && n > patternCount) {
      fail(`${ALLOW_FILE}:${i + 1}: pattern #${n} does not exist (${patternCount} patterns)`);
    }
    entries.push({ line: i + 1, n, scope: m[2], path: m[3] });
    return `${m[1]} ${m[2]} # ${m[4]}`;
  });
  return { entries, scanText: scanLines.join('\n') };
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

// Rendered on pearse.dev through src/lib/excerpt-sources.ts: an edit between these markers changes the site.
// excerpt:start gate-reporting
/**
 * Test `texts` (one file's strings, or its path) against every pattern in both passes. Returns
 * the number of each pattern that hits in either. The normalised copies are computed once.
 */
function matchTexts(texts, patterns) {
  const normalised = texts.map((t) => normalise(String(t)));
  const numbers = [];
  patterns.forEach(({ raw, folded }, i) => {
    if (texts.some((t) => raw.test(t)) || normalised.some((t) => folded.test(t))) numbers.push(i + 1);
  });
  return numbers;
}

/** A hit is printed as the file and the pattern number, never the text it matched. */
function report({ n, scope, path }) {
  console.log(`${escapePath(path)}: pattern #${n}${scope === 'path' ? ' (path)' : ''}`);
}
// excerpt:end gate-reporting

const pathHits = (path, patterns) =>
  matchTexts([path], patterns).map((n) => ({ n, scope: 'path', path }));

/**
 * Content hits of one file's bytes, or null for an unreadable PDF. A `.pdf` is routed by
 * extension before the NUL-byte check: it is binary but carries text. `text` replaces the
 * decoded bytes when given (the `.gate-allow` scan text).
 */
async function contentHits(path, buf, patterns, text = null) {
  let texts;
  if (extname(path).toLowerCase() === '.pdf') {
    try {
      texts = scanStrings(await readPdf(buf));
    } catch {
      return null;
    }
  } else if (isBinary(buf)) {
    return [];
  } else {
    texts = [text ?? buf.toString('utf8')];
  }
  return matchTexts(texts, patterns).map((n) => ({ n, scope: 'content', path }));
}

/**
 * Print every hit `.gate-allow` does not suppress, every problem line and (when `judgeStale`)
 * every stale entry, then exit 1 if there was any. Hits are the raw hits, so staleness is judged
 * before suppression. Returns the number of allowed hits.
 */
function settle(hits, problems, entries, judgeStale) {
  const same = (a, b) => a.n === b.n && a.scope === b.scope && a.path === b.path;
  const stale = judgeStale ? entries.filter((e) => !hits.some((h) => same(h, e))) : [];
  const reported = hits.filter((h) => !entries.some((e) => same(h, e)));

  for (const h of reported) report(h);
  for (const p of problems) console.log(p);
  for (const e of stale) {
    console.log(`${ALLOW_FILE}:${e.line}: stale entry, no pattern #${e.n} ${e.scope} hit in ${escapePath(e.path)}`);
  }
  const count = reported.length + problems.length;
  if (count || stale.length) {
    const s = stale.length ? `, ${stale.length} stale ${ALLOW_FILE} entr${stale.length === 1 ? 'y' : 'ies'}` : '';
    fail(`FAILED, ${count} hit(s)${s}`);
  }
  return hits.length;
}

const allowedNote = (n) => (n ? `, ${n} allowed by ${ALLOW_FILE}` : '');

/** Run git, return stdout as a Buffer; throws when git fails. stderr is dropped. */
function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 1 << 30,
  });
}

/** Tracked paths from the index (`-z`: plain output quotes non-ASCII), or null without git or a repo. */
function trackedFiles() {
  try {
    return git(['ls-files', '-z'], process.cwd()).toString('utf8').split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/** Only regular files: deleted entries, symlinks and gitlinks (directories) are skipped. */
function isRegularFile(p) {
  try {
    return lstatSync(p).isFile();
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
}

/** dist/ walked whole (it is gitignored), with forward-slash paths. */
function walkDist(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) walkDist(p, out);
    else out.push(p);
  }
  return out;
}

async function scanTree() {
  if (!existsSync('dist')) fail('dist/ not found, run the build first');

  const raw = loadPatterns(PATTERN_FILE);
  const allow = parseAllow(existsSync(ALLOW_FILE) ? readFileSync(ALLOW_FILE, 'utf8') : null, raw.length);
  checkList(raw);
  const patterns = compilePatterns(raw);

  const files = new Set();
  const tracked = trackedFiles();
  if (tracked === null) {
    if (required) fail('FAILED, git is unavailable or this is not a git repository (GATE_REQUIRED=1)');
    warn('git is unavailable or this is not a git repository, only dist/ was scanned');
  } else {
    for (const p of tracked) if (isRegularFile(p)) files.add(p);
  }
  for (const p of walkDist('dist')) files.add(p);

  const hits = [];
  const problems = [];
  for (const path of [...files].sort()) {
    hits.push(...pathHits(path, patterns));
    if (BINARY_EXT.has(extname(path).toLowerCase())) continue;
    const found = await contentHits(path, readFileSync(path), patterns, path === ALLOW_FILE ? allow.scanText : null);
    if (found === null) problems.push(`${escapePath(path)}: unreadable PDF`);
    else hits.push(...found);
  }

  const allowed = settle(hits, problems, allow.entries, true);
  console.log(`confidentiality gate: ok (${patterns.length} patterns, ${files.size} files, no hits${allowedNote(allowed)})`);
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

/** The index's `.gate-allow` text (what will be committed), or null when it has none. */
function stagedAllowText(top) {
  try {
    return git(['cat-file', 'blob', `:${ALLOW_FILE}`], top).toString('utf8');
  } catch {
    return null;
  }
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
  if (process.argv.length > 3) fail('--staged takes no other arguments');
  let top;
  try {
    top = git(['rev-parse', '--show-toplevel'], process.cwd()).toString('utf8').replace(/\r?\n$/, '');
  } catch {
    fail('--staged needs a git work tree, none found here');
  }

  const mainFile = mainWorktreePatternFile(top);
  const raw = loadPatterns(join(top, PATTERN_FILE), ...(mainFile ? [mainFile] : []));
  const allow = parseAllow(stagedAllowText(top), raw.length);
  checkList(raw, { staged: true, checkedMain: mainFile !== null });
  const patterns = compilePatterns(raw);

  let files;
  try {
    files = stagedFiles(top);
  } catch {
    fail('could not read the git index');
  }
  if (files.length === 0) {
    console.log('confidentiality gate: nothing staged, ok');
    return;
  }

  const hits = [];
  const problems = [];
  for (const { path, sha } of files) {
    hits.push(...pathHits(path, patterns));
    if (BINARY_EXT.has(extname(path).toLowerCase())) continue;
    let buf;
    try {
      buf = git(['cat-file', 'blob', sha], top);
    } catch {
      problems.push(`${escapePath(path)}: unreadable index entry`);
      continue;
    }
    const found = await contentHits(path, buf, patterns, path === ALLOW_FILE ? allow.scanText : null);
    if (found === null) problems.push(`${escapePath(path)}: unreadable PDF`);
    else hits.push(...found);
  }

  const allowed = settle(hits, problems, allow.entries, false);
  console.log(
    `confidentiality gate: ok (${patterns.length} patterns, ${files.length} staged file(s), no hits${allowedNote(allowed)})`,
  );
}

if (process.argv[2] === '--fingerprint') {
  const list = loadPatterns(PATTERN_FILE);
  console.log(`patterns: ${list.length}`);
  console.log(`sha256: ${fingerprint(list)}`);
} else if (process.argv[2] === '--staged') await scanStaged();
else await scanTree();
