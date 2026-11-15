// Keeps the written record in step with itself (#170): the ADR files, the ADR range that
// CLAUDE.md and the README quote, the npm commands the README names, and the CHANGELOG's
// one-entry-per-PR wave sections (#170, #291). Reads source files only, never dist/, so
// `node --test tests/docs-drift.test.mjs` passes with no build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const ADR_DIR = 'docs/adr';
const adrFiles = () => readdirSync(resolve(ROOT, ADR_DIR)).filter((f) => f.endsWith('.md')).sort();
const pad = (n) => String(n).padStart(4, '0');

test('every ADR file is named NNNN-slug.md and the numbers run from 0001 with no gap or repeat', () => {
  const files = adrFiles();
  assert.ok(files.length > 0, 'no ADRs found');
  for (const f of files) assert.match(f, /^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/, f);
  const numbers = files.map((f) => Number(f.slice(0, 4)));
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1), `ADR numbers: ${numbers.join(', ')}`);
});

test('every ADR has status and date frontmatter and exactly one title line', () => {
  for (const f of adrFiles()) {
    const text = read(`${ADR_DIR}/${f}`);
    const front = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(front, `${f}: no frontmatter`);
    assert.match(front[1], /^status: (accepted|superseded|deprecated|proposed)\b/m, `${f}: status`);
    assert.match(front[1], /^date: \d{4}-\d{2}-\d{2}$/m, `${f}: date`);
    const titles = text.split('\n').filter((l) => l.startsWith('# '));
    assert.equal(titles.length, 1, `${f}: ${titles.length} title lines`);
  }
});

test('CLAUDE.md and the README Docs list quote the real ADR range', () => {
  const last = pad(adrFiles().length);
  for (const p of ['CLAUDE.md', 'README.md']) {
    const ranges = [...read(p).matchAll(/\b0001 to (\d{4})\b/g)].map((m) => m[1]);
    assert.ok(ranges.length > 0, `${p} quotes no ADR range`);
    for (const r of ranges) assert.equal(r, last, `${p} says 0001 to ${r}, the last ADR is ${last}`);
  }
});

// `npm run x`, `npm run-script x` and `npm --flag=value run x`. Script names may hold digits (a11y).
const NPM_RUN = /\bnpm(?: --[\w-]+(?:=\S+)?)* run(?:-script)? ([a-z0-9][a-z0-9:-]*)/g;

test('the matcher reads plain, run-script, flagged and digit-bearing commands', () => {
  const names = (s) => [...s.matchAll(NPM_RUN)].map((m) => m[1]);
  assert.deepEqual(names('npm run build && npm run-script a11y; npm --script-shell=/bin/sh run cv:pdf'), ['build', 'a11y', 'cv:pdf']);
  assert.deepEqual(names('npm run gate -- --staged'), ['gate']);
});

test('every npm script the README names exists in package.json', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const named = [...new Set([...read('README.md').matchAll(NPM_RUN)].map((m) => m[1]))];
  assert.ok(named.length > 10, `only ${named.length} commands found`);
  const missing = named.filter((s) => !(s in scripts));
  assert.deepEqual(missing, [], `README names missing scripts: ${missing.join(', ')}`);
});

test('the README Commands block lists every user-facing npm script', () => {
  const readme = read('README.md');
  const block = readme.slice(readme.indexOf('## Commands'), readme.indexOf('\n## ', readme.indexOf('## Commands') + 5));
  const listed = new Set([...block.matchAll(NPM_RUN)].map((m) => m[1]));
  const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
  // npm lifecycle hooks (prepare, and pre<x>/post<x> for a script x) run on their own.
  const isHook = (s) => s === 'prepare' || scripts.some((x) => s === `pre${x}` || s === `post${x}`);
  // `npm test` is written without `run`; `astro` is the raw CLI that dev, build and check wrap.
  const covered = new Set(['astro', 'test']);
  const unlisted = scripts.filter((s) => !isHook(s) && !covered.has(s) && !listed.has(s));
  assert.deepEqual(unlisted, [], `README Commands omits: ${unlisted.join(', ')}`);
});

const changelog = () => read('CHANGELOG.md');

test('no pull request has two CHANGELOG entries', () => {
  const prs = changelog().split('\n').map((l) => l.match(/^- PR #(\d+), /)?.[1]).filter(Boolean);
  assert.ok(prs.length > 0, 'no "- PR #n," entries');
  const dupes = prs.filter((p, i) => prs.indexOf(p) !== i);
  assert.deepEqual(dupes, [], `PRs listed twice: ${dupes.join(', ')}`);
});

/** Every `## … wave (epic #n)` section of the CHANGELOG, as [heading, body]. */
function waveSections(log) {
  const heads = [...log.matchAll(/^## (.+ wave \(epic #\d+\))$/gm)];
  return heads.map((m) => {
    const end = log.indexOf('\n## ', m.index + 1);
    return [m[1], log.slice(m.index, end === -1 ? undefined : end)];
  });
}

test('the wave reader finds each wave heading and stops at the next section', () => {
  const log = '# C\n\n## Unreleased\n\n## 2026-12-01: Late wave (epic #9)\n\n### 2026-12-01\n\n- PR #2, issue #8. Added: b.\n\n## 2026-11-01: Early wave (epic #7)\n\n- PR #1, issue #6. Fixed: a.\n';
  const sections = waveSections(log);
  assert.deepEqual(sections.map(([h]) => h), ['2026-12-01: Late wave (epic #9)', '2026-11-01: Early wave (epic #7)']);
  assert.ok(!sections[0][1].includes('PR #1'), 'a section runs into the next one');
  assert.ok(sections[1][1].includes('PR #1'), 'the last section is cut short');
});

test('each wave section lists its merge dates oldest first and one "PR #n, issue #m" entry per line', () => {
  const sections = waveSections(changelog());
  const names = sections.map(([h]) => h);
  for (const wave of ['November 2026 wave (epic #91)', 'December 2026 wave (epic #260)']) {
    assert.ok(names.some((n) => n.endsWith(wave)), `no ${wave} section`);
  }
  for (const [heading, section] of sections) {
    const days = [...section.matchAll(/^### (\d{4}-\d{2}-\d{2})$/gm)].map((m) => m[1]);
    assert.ok(days.length > 0, `${heading}: no dated subsections`);
    assert.deepEqual(days, [...days].sort(), `${heading}: ${days.join(', ')}`);
    for (const line of section.split('\n').filter((l) => l.startsWith('- '))) {
      assert.match(line, /^- PR #\d+, (issues? #\d+(, #\d+)*|Dependabot)\. /, line.slice(0, 60));
    }
  }
});
