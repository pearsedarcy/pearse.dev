// Keeps docs/content-checklists.md from drifting away from the repo (issue #165). Reads source
// files only, never dist/, so `node --test tests/content-checklists.test.mjs` passes with no build.
//
// Two drift checks: every repo path the doc cites in backticks exists, and every registry
// identifier the doc names is still defined in the file REGISTRIES says. Plus the doc's shape:
// four numbered checklists, each step naming its enforcement, Verify blocks that need nothing but
// the repo's own checks and grep/ls against dist/, and README links that land on a real anchor.
//
// REGISTRIES is the only map from an identifier to its file. When a registry is removed or
// renamed, change its row here and the step in the doc that names it. Definitions are matched by
// regex on the file text: astro.config.mjs is never imported (its map is not exported, and
// importing it would run the config), and no registry's contents are read, printed or iterated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OLD_NAMES } from './lib/old-names.mjs';
import { citedPaths, inlineTokens, isRepoPath } from './lib/repo-paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOC_PATH = 'docs/content-checklists.md';
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const doc = () => read(DOC_PATH);

/** identifier -> { file, definition }. The one place a registry is named; a doc step cites the identifier only. */
const REGISTRIES = {
  DIAGRAM_NAMES: { file: 'src/lib/diagrams.ts', definition: /export const DIAGRAM_NAMES\b/ },
  DIAGRAMS: { file: 'src/components/diagrams/index.ts', definition: /export const DIAGRAMS\b/ },
  MOVED_CASE_STUDIES: { file: 'astro.config.mjs', definition: /const MOVED_CASE_STUDIES\b/ },
  FEATURED_REPOS: { file: 'src/lib/github.ts', definition: /export const FEATURED_REPOS\b/ },
  SHOWN_REPOS: { file: 'src/lib/github.ts', definition: /export const SHOWN_REPOS\b/ },
  LEARNING_REPOS: { file: 'src/lib/github.ts', definition: /export const LEARNING_REPOS\b/ },
};

const FIX = `Edit its row in REGISTRIES in tests/content-checklists.test.mjs and the step in ${DOC_PATH} that names it.`;

/** The four checklists: [{ anchor, heading, body }], split on the "## n." headings. */
function checklists(text) {
  const parts = text.split(/^(?=<a id=")/m).slice(1);
  return parts.map((part) => ({
    anchor: part.match(/^<a id="([^"]+)">/)[1],
    heading: part.match(/^## (.+)$/m)?.[1] ?? '',
    body: part,
  }));
}

const CHECKLISTS = ['add-a-case-study', 'add-an-article', 'add-a-standalone-post', 'rename-or-fold-a-case-study'];

test('every repo path cited in backticks exists', () => {
  const paths = citedPaths(doc());
  assert.ok(paths.length >= 20, `only ${paths.length} repo paths found: is the path rule too narrow?`);
  for (const p of paths) assert.ok(existsSync(resolve(ROOT, p)), `${DOC_PATH} cites \`${p}\`, which does not exist`);
});

test('the path rule skips placeholders, globs, URL paths and dist/ paths', () => {
  for (const t of ['src/content/<slug>.md', 'src/…', 'tests/*.mjs', '/work/<slug>/', 'dist/work/x/index.html', 'npm run check', 'REGISTRIES']) {
    assert.equal(isRepoPath(t), false, t);
  }
  for (const t of ['src/lib/tags.ts', 'astro.config.mjs', 'docs/adr/', '.github/workflows/check.yml']) assert.equal(isRepoPath(t), true, t);
});

test('every registry definition regex matches its file', () => {
  for (const [id, { file, definition }] of Object.entries(REGISTRIES)) {
    assert.ok(existsSync(resolve(ROOT, file)), `${id}: ${file} does not exist. ${FIX}`);
    assert.match(read(file), definition, `${id} is no longer defined in ${file}. ${FIX}`);
  }
});

test('every registry identifier appears in the doc, and every identifier the doc backticks has a row', () => {
  const tokens = new Set(inlineTokens(doc()));
  for (const t of tokens) {
    if (/^[A-Z][A-Z0-9_]{3,}$/.test(t)) assert.ok(t in REGISTRIES, `${DOC_PATH} names \`${t}\`, which has no row in REGISTRIES. ${FIX}`);
  }
  for (const id of Object.keys(REGISTRIES)) assert.ok(tokens.has(id), `${id} has a REGISTRIES row but ${DOC_PATH} never names it. ${FIX}`);
});

test('the doc has four numbered checklists, in order, each with its anchor and a Verify block', () => {
  const lists = checklists(doc());
  assert.deepEqual(lists.map((l) => l.anchor), CHECKLISTS);
  lists.forEach((l, i) => {
    assert.match(l.heading, new RegExp(`^${i + 1}\\. `), `heading of ${l.anchor} is not numbered ${i + 1}`);
    assert.match(l.body, /^\*\*Verify\*\*\s*\n\s*\n```sh\n[\s\S]+?\n```/m, `${l.anchor} has no Verify block`);
    const steps = l.body.match(/^\d+\. .+$/gm) ?? [];
    assert.ok(steps.length >= 5, `${l.anchor}: only ${steps.length} steps`);
  });
});

test('every step is one line that names a file and an enforcement (or says "Not enforced")', () => {
  for (const l of checklists(doc())) {
    const steps = l.body.match(/^\d+\. .+$/gm) ?? [];
    steps.forEach((step, i) => {
      const n = `${l.anchor} step ${i + 1}`;
      assert.match(step, /`[^`]+`/, `${n} names no file or identifier`);
      assert.match(step, /Enforced by:|Not enforced|enforced by:|Partially enforced by:/, `${n} says nothing about enforcement`);
    });
    assert.deepEqual(
      steps.map((s) => Number(s.match(/^(\d+)\./)[1])),
      steps.map((_, i) => i + 1),
      `${l.anchor}: step numbers are not 1..n`,
    );
  }
});

test('a step that claims enforcement cites a check in backticks, and a cited npm script exists', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const l of checklists(doc())) {
    for (const step of l.body.match(/^\d+\. .+$/gm) ?? []) {
      const m = step.match(/(?:Enforced by|enforced by|Partially enforced by): (.+)$/);
      if (!m) continue;
      const cited = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
      assert.ok(cited.length > 0, `${l.anchor}: "${step.slice(0, 60)}…" claims enforcement and cites nothing`);
      for (const c of cited) {
        const run = c.match(/^npm run ([\w:-]+)$/);
        if (run) assert.ok(run[1] in scripts, `${l.anchor}: npm script "${run[1]}" does not exist`);
      }
    }
  }
});

test('Verify blocks run only the repo checks and grep/ls against dist/: no server, no network', () => {
  const allowed = [/^npm run (check|build|gate|links)$/, /^npm test$/, /^(grep|ls)\b.*\bdist\//];
  let lines = 0;
  for (const l of checklists(doc())) {
    const block = l.body.match(/^\*\*Verify\*\*\s*\n\s*\n```sh\n([\s\S]+?)\n```/m)[1];
    for (const line of block.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))) {
      lines++;
      assert.ok(allowed.some((re) => re.test(line)), `${l.anchor}: Verify line not allowed: ${line}`);
    }
    for (const must of ['npm run check', 'npm test', 'npm run gate', 'npm run links']) {
      assert.ok(block.split('\n').includes(must), `${l.anchor}: Verify block lacks ${must}`);
    }
  }
  assert.ok(lines >= 20, `only ${lines} Verify lines found`);
});

test('the doc has no curl, no preview server, no YAML fence and no frontmatter block', () => {
  const text = doc();
  assert.doesNotMatch(text, /\bcurl\b/, 'curl needs the network');
  assert.doesNotMatch(text, /npm run preview/, 'a preview server is not available in a clean checkout');
  assert.doesNotMatch(text, /```ya?ml/i, 'field definitions live in the README, not here');
  assert.doesNotMatch(text, /^---\s*$/m, 'the doc carries no frontmatter block');
});

test('the doc states no description length and points at the posts schema', () => {
  const text = doc();
  assert.match(text, /length limit: see the posts schema in `src\/content\.config\.ts`/);
  assert.doesNotMatch(text, /\b(155|160)\b/, 'a description length would drift from the schema');
});

test('the README links each Add section and the Diagrams steps to a real checklist anchor, and lists the doc', () => {
  const readme = read('README.md');
  const anchors = new Set(checklists(doc()).map((l) => l.anchor));
  const linked = [...readme.matchAll(/docs\/content-checklists\.md#([a-z0-9-]+)/g)].map((m) => m[1]);
  for (const a of linked) assert.ok(anchors.has(a), `README links content-checklists.md#${a}, which is not a checklist anchor`);
  const section = (title) => {
    const m = readme.match(new RegExp(`^### ${title}\\n([\\s\\S]*?)(?=^### |^## )`, 'm'));
    assert.ok(m, `README has no "### ${title}" section`);
    return m[1];
  };
  for (const [title, anchor] of [
    ['Add a project', 'add-a-case-study'],
    ['Diagrams', 'add-a-case-study'],
    ['Add a post', 'add-an-article'],
    ['Add a standalone post', 'add-a-standalone-post'],
  ]) {
    assert.ok(section(title).includes(`docs/content-checklists.md#${anchor}`), `README "${title}" does not link #${anchor}`);
  }
  assert.ok(section('Add a project').includes('docs/content-checklists.md#rename-or-fold-a-case-study'), 'README "Add a project" does not link the rename checklist');
  assert.match(readme.slice(readme.indexOf('\n## Docs')), /\[`docs\/content-checklists\.md`\]\(docs\/content-checklists\.md\)/);
});

test('the README names no description character count: it points at the schema', () => {
  const line = read('README.md').split('\n').find((l) => /^description:/.test(l));
  assert.ok(line, 'README Add a post has no description line');
  assert.doesNotMatch(line, /\d/, 'the README description line states a number');
  assert.match(line, /src\/content\.config\.ts/);
});

test('the CHANGELOG records the doc under Unreleased > Added', () => {
  const log = read('CHANGELOG.md');
  const unreleased = log.slice(log.indexOf('## Unreleased'), log.indexOf('\n## ', log.indexOf('## Unreleased') + 5));
  const added = unreleased.slice(unreleased.indexOf('### Added'));
  assert.match(added, /docs\/content-checklists\.md/);
});

test('neither new file names the retired product or the folded tools, in any letter case', () => {
  // The gate scans docs/ but not tests/ (#98), so this covers both files by their own source.
  const own = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.doesNotMatch(doc(), OLD_NAMES, DOC_PATH);
  assert.doesNotMatch(own, OLD_NAMES, 'tests/content-checklists.test.mjs');
});
