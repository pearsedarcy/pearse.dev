// Build facts (#287): the impure collector (src/lib/build-facts-git.ts) against throwaway git
// repositories, full and shallow, and the pearse.dev case page it feeds. The page checks read
// dist/ (`npm test`'s pretest build) and recompute the facts with the same collector from the
// same HEAD, so they hold in a full clone (four items, two sentences) and a shallow one (two, one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACT_LABELS, factsRow, factsSentences } from '../src/lib/build-facts.ts';
import { collectBuildFacts } from '../src/lib/build-facts-git.ts';
import { parseHtml, find, text, hasClass } from './lib/html.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

// --- the collector against a fixture repository ----------------------------------------------

const GIT_ID = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (cwd, ...args) => execFileSync('git', [...GIT_ID, ...args], { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'build-facts-'));
  const repo = join(dir, 'full');
  mkdirSync(join(repo, 'tests/lib'), { recursive: true });
  mkdirSync(join(repo, 'docs/adr'), { recursive: true });
  for (const f of ['tests/a.test.mjs', 'tests/lib/b.test.mjs', 'tests/lib/helper.mjs', 'tests/c.test.js']) writeFileSync(join(repo, f), '');
  for (const f of ['docs/adr/0001-one.md', 'docs/adr/0002-two.md', 'docs/adr/README.md', 'docs/adr/template.md']) writeFileSync(join(repo, f), '');
  git(repo, 'init', '-q');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'chore: start\n\nCo-authored-by: Jane Example <jane@example.com>');
  git(repo, 'checkout', '-q', '-b', 'feature/x');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nCo-authored-by: Claude Sonnet 5.5 <noreply@anthropic.com>');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'fix: y\n\nCo-authored-by: Claude Code <noreply@anthropic.com>');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', 'feature/x', '-m', 'Merge pull request #7 from someone/feature/x');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: bump\n\nCo-authored-by: dependabot[bot] <bot@users.noreply.github.com>');
  return { dir, repo };
}

test('the collector counts a full fixture repository', () => {
  const { dir, repo } = fixtureRepo();
  try {
    const facts = collectBuildFacts(repo);
    assert.deepEqual(facts, {
      testFiles: 2,
      adrs: 2,
      git: { commits: 4, agentCommits: 2, mergedPRs: 1, families: [{ family: 'Opus', trailers: 1 }, { family: 'Sonnet', trailers: 1 }] },
    });
    assert.equal(collectBuildFacts(repo), facts, 'memoised per build');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a shallow clone, or no git at all, drops the git figures and nothing else', () => {
  const { dir, repo } = fixtureRepo();
  try {
    const shallow = join(dir, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${repo}`, shallow], { env: ENV, stdio: 'ignore' });
    assert.deepEqual(collectBuildFacts(shallow), { testFiles: 2, adrs: 2 });
    rmSync(join(repo, '.git'), { recursive: true, force: true });
    const plain = join(dir, 'plain');
    execFileSync('cp', ['-r', repo, plain]);
    assert.deepEqual(collectBuildFacts(plain), { testFiles: 2, adrs: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the rendered pearse.dev case page ------------------------------------------------------

const html = readFileSync('dist/work/pearse-dev/index.html', 'utf8');
const doc = parseHtml(html);
const facts = collectBuildFacts(ROOT);
const row = factsRow(facts);
const paragraphs = find(doc, (el) => el.tag === 'p' && 'data-build-facts' in el.attrs);

test("the case-outcomes row equals the builder's row, item for item and in order", () => {
  const dls = find(doc, (el) => el.tag === 'dl' && hasClass(el, 'case-outcomes'));
  assert.equal(dls.length, 1);
  const items = find(dls[0], (el) => el.tag === 'div').map((div) => ({
    value: text(find(div, (el) => el.tag === 'dd')[0]).trim(),
    label: text(find(div, (el) => el.tag === 'dt')[0]).trim(),
  }));
  assert.deepEqual(items, row);
  assert.equal(row.length, facts.git ? 4 : 2);
});

test('the computed paragraph carries every row value as a whole word, and S2 only with git', () => {
  assert.equal(paragraphs.length, 1, 'one computed paragraph');
  const p = text(paragraphs[0]).replace(/\s+/g, ' ').trim();
  assert.equal(p, factsSentences(facts).join(' '));
  for (const { value } of row) assert.match(p, new RegExp(`(?<![\\w.])${value}(?![\\w])`), `${value} in the paragraph`);
  assert.equal(/commits carry a Claude/.test(html), facts.git !== undefined, 'S2 renders exactly when git facts exist');
});

test('the computed paragraph closes the Notes section, after the Colophon heading', () => {
  const [notes] = find(doc, (el) => el.tag === 'section' && el.attrs['aria-label'] === 'Notes');
  assert.ok(notes, 'Notes section');
  const order = find(notes, (el) => el.tag === 'h2' || el.tag === 'p');
  const h2s = order.filter((el) => el.tag === 'h2');
  assert.equal(text(h2s.at(-1)).trim(), 'Colophon', 'Colophon is the last h2');
  const at = order.indexOf(paragraphs[0]);
  assert.ok(at > order.indexOf(h2s.at(-1)), 'paragraph after the Colophon heading');
  assert.equal(at, order.length - 1, 'paragraph is the last one in Notes');
  assert.ok(html.includes('href="/work/agentic-workflow/"'), 'the agentic-workflow link stays in static copy');
  assert.equal(find(paragraphs[0], (el) => el.tag === 'a').length, 0, 'no links in the computed paragraph');
});

test("pearse-dev's computed labels are the four constants, with integer values", () => {
  const labels = Object.values(FACT_LABELS);
  assert.deepEqual(row.map((o) => o.label), labels.slice(0, row.length));
  for (const { value } of row) assert.match(value, /^\d+$/);
});
