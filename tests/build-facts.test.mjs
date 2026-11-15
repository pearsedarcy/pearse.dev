// Build facts (#287): the pure module behind the pearse.dev case study's computed outcomes row
// and colophon paragraph (src/lib/build-facts.ts), loaded through Node type stripping. No git and
// no dist/ here: the collector and the rendered page are in tests/build-facts-page.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FACT_LABELS,
  MODEL_FAMILIES,
  TEST_GLOB,
  agentsWroteMost,
  buildFactsIssues,
  claudeTrailer,
  countMergedPRs,
  factsParagraph,
  factsRow,
  factsSentences,
  gitFacts,
  splitTrailerLog,
} from '../src/lib/build-facts.ts';
import { BUSINESS_COUNT_WORDS, OUTCOME_LABEL_MAX, outcomeIssues } from '../src/lib/outcomes.ts';
import { SITE } from '../src/lib/site.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const HUMAN = 'Co-authored-by: Jane Example <jane@example.com>';
const BOT = 'Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>';
const OPUS = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const SONNET = 'Co-authored-by: Claude Sonnet 5.5 <noreply@anthropic.com>';
const FABLE = 'co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>';
const BARE = 'Co-Authored-By: Claude <noreply@anthropic.com>';
const CODE = 'Co-authored-by: Claude Code <noreply@anthropic.com>';

/** Every rendered string for a set of facts: S1, S2 and the row's labels and values. */
const rendered = (facts) => [...factsSentences(facts), ...factsRow(facts).flatMap((o) => [o.value, o.label])].join('\n');
const facts = (commits, subjects = []) => ({ testFiles: 74, adrs: 7, git: gitFacts(commits, subjects) });

test('the constants: four families in tie-break order, four short engineering labels', () => {
  assert.deepEqual([...MODEL_FAMILIES], ['Fable', 'Opus', 'Sonnet', 'Haiku']);
  assert.deepEqual(Object.values(FACT_LABELS), ['test files', 'ADRs', 'merged pull requests', 'commits with a Claude co-author']);
  const business = new RegExp(`\\b(?:${BUSINESS_COUNT_WORDS.join('|')})\\b`, 'i');
  for (const label of Object.values(FACT_LABELS)) {
    assert.ok(label.length <= OUTCOME_LABEL_MAX, label);
    assert.doesNotMatch(label, business, label);
  }
});

test('human and bot co-author trailers are never counted and their text is never rendered', () => {
  const f = facts([[HUMAN], [BOT], [HUMAN, BOT, 'Signed-off-by: Jane Example <jane@example.com>']]);
  assert.equal(f.git.commits, 3);
  assert.equal(f.git.agentCommits, 0);
  assert.deepEqual(f.git.families, []);
  assert.equal(claudeTrailer('Jane Example <jane@example.com>'), null);
  assert.equal(claudeTrailer('dependabot[bot] <x@users.noreply.github.com>'), null);
  assert.equal(claudeTrailer('Claudette Example <c@example.com>'), null, 'a name that only starts with Claude');
  const out = rendered(f);
  for (const leak of ['Jane', 'Example', 'example.com', 'dependabot', 'bot', 'noreply', '@']) {
    assert.ok(!out.includes(leak), `"${leak}" is not rendered`);
  }
  assert.doesNotMatch(factsParagraph(f), /\(/, 'no families parenthetical when none were named');
});

test('a bare Claude trailer and "Claude Code" count as agent commits with no family, and "Code" is never rendered', () => {
  assert.deepEqual(claudeTrailer('Claude <noreply@anthropic.com>'), {});
  assert.deepEqual(claudeTrailer('Claude Code <noreply@anthropic.com>'), {});
  assert.deepEqual(claudeTrailer('Claude opus 5.5 <noreply@anthropic.com>'), {}, 'family needs exact case');
  assert.deepEqual(claudeTrailer('Claude Opus 5.5 <noreply@anthropic.com>'), { family: 'Opus' });
  const f = facts([[BARE], [CODE], [HUMAN]]);
  assert.equal(f.git.agentCommits, 2);
  assert.deepEqual(f.git.families, []);
  const out = rendered(f);
  for (const leak of ['Code', 'noreply', 'anthropic']) assert.ok(!out.includes(leak), `"${leak}" is not rendered`);
});

test('the co-author key matches in any case; other keys never count', () => {
  const f = facts([[OPUS], [FABLE], ['Reviewed-by: Claude Opus 5.5 <noreply@anthropic.com>'], ['Claude Opus 5.5']]);
  assert.equal(f.git.agentCommits, 2);
  assert.deepEqual(f.git.families, [
    { family: 'Fable', trailers: 1 },
    { family: 'Opus', trailers: 1 },
  ]);
});

test('a commit with two Claude trailers counts once as an agent commit and once per family', () => {
  const f = facts([[OPUS, SONNET, BARE], [OPUS, 'Co-authored-by: Claude Opus 5 <noreply@anthropic.com>']]);
  assert.equal(f.git.agentCommits, 2);
  assert.deepEqual(f.git.families, [
    { family: 'Opus', trailers: 2 },
    { family: 'Sonnet', trailers: 1 },
  ]);
});

test('families sort by count, then MODEL_FAMILIES order, with zero counts dropped', () => {
  const f = facts([[SONNET], [SONNET], [OPUS], [FABLE], ['Co-authored-by: Claude Haiku 5 <noreply@anthropic.com>'], [HUMAN]]);
  assert.deepEqual(
    f.git.families.map((x) => [x.family, x.trailers]),
    [['Sonnet', 2], ['Fable', 1], ['Opus', 1], ['Haiku', 1]],
  );
  assert.match(factsParagraph(f), /\(2 Sonnet, 1 Fable, 1 Opus, 1 Haiku\)/);
  const noHaiku = facts([[OPUS], [FABLE]]);
  assert.deepEqual(noHaiku.git.families.map((x) => x.family), ['Fable', 'Opus']);
});

test('the "most" clause: 79 of 158 omits it, 80 of 158 renders it', () => {
  assert.equal(agentsWroteMost({ commits: 158, agentCommits: 79 }), false);
  assert.equal(agentsWroteMost({ commits: 158, agentCommits: 80 }), true);
  const at = (agent) => {
    const commits = [...Array.from({ length: agent }, () => [OPUS]), ...Array.from({ length: 158 - agent }, () => [])];
    return factsParagraph(facts(commits));
  };
  assert.doesNotMatch(at(79), /most/);
  assert.match(at(80), /, so agents wrote most of it\.$/);
});

test('the full sentences, word for word', () => {
  const f = { testFiles: 74, adrs: 7, git: { commits: 158, agentCommits: 143, mergedPRs: 116, families: [{ family: 'Sonnet', trailers: 72 }, { family: 'Opus', trailers: 62 }, { family: 'Fable', trailers: 10 }] } };
  assert.deepEqual(factsSentences(f), [
    'At this build the repository holds 74 test files and 7 ADRs in docs/adr/.',
    '116 pull requests have merged, and 143 of its 158 commits carry a Claude co-author trailer (72 Sonnet, 62 Opus, 10 Fable), so agents wrote most of it.',
  ]);
  assert.deepEqual(factsRow(f), [
    { value: '74', label: 'test files' },
    { value: '7', label: 'ADRs' },
    { value: '116', label: 'merged pull requests' },
    { value: '143', label: 'commits with a Claude co-author' },
  ]);
  assert.deepEqual(outcomeIssues({ outcomes: factsRow(f) }), [], 'the computed row passes the outcomes validator');
});

test('with git absent the row has items 1 and 2 only and the paragraph has S1 only', () => {
  const f = { testFiles: 74, adrs: 7 };
  assert.deepEqual(factsRow(f), [
    { value: '74', label: 'test files' },
    { value: '7', label: 'ADRs' },
  ]);
  assert.deepEqual(factsSentences(f), ['At this build the repository holds 74 test files and 7 ADRs in docs/adr/.']);
  assert.equal(factsParagraph(f), factsSentences(f)[0]);
  assert.deepEqual(outcomeIssues({ outcomes: factsRow(f) }), []);
});

test('merged pull requests: distinct "Merge pull request #N" subjects only', () => {
  assert.equal(
    countMergedPRs([
      'Merge pull request #12 from someone/feature/a',
      'Merge pull request #12 from someone/feature/a',
      'Merge pull request #13 from someone/feature/b',
      "Merge branch 'master' into feature/c",
      'Merge origin/master into feature/d',
      'Merge 0123456789abcdef0123456789abcdef01234567 into fedcba9876543210fedcba9876543210fedcba98',
      'feat: something (#14)',
      'Revert "Merge pull request #15 from someone/x"',
      '',
    ]),
    2,
  );
  assert.equal(countMergedPRs([]), 0);
});

test('splitTrailerLog keeps one record per commit, trailers or not', () => {
  const raw = `\x1e${OPUS}\n${HUMAN}\n\n\x1e\n\x1e${BARE}\n`;
  assert.deepEqual(splitTrailerLog(raw), [[OPUS, HUMAN], [], [BARE]]);
  assert.deepEqual(splitTrailerLog(''), []);
});

test('the schema refinement: buildFacts needs this repo and no hand-written outcomes', () => {
  const ok = { buildFacts: true, repo: SITE.repo };
  assert.deepEqual(buildFactsIssues(ok), []);
  assert.deepEqual(buildFactsIssues({ buildFacts: false, repo: 'https://github.com/someone/else', outcomes: [] }), []);
  assert.deepEqual(buildFactsIssues({ repo: 'https://github.com/someone/else' }), [], 'absent is off');
  const paths = (d) => buildFactsIssues(d).map((i) => i.path);
  assert.deepEqual(paths({ ...ok, repo: 'https://github.com/someone/else' }), ['buildFacts']);
  assert.deepEqual(paths({ buildFacts: true }), ['buildFacts'], 'no repo at all');
  assert.deepEqual(paths({ ...ok, outcomes: [{ value: '22', label: 'ADRs' }] }), ['outcomes']);
  const config = readFileSync('src/content.config.ts', 'utf8');
  assert.match(config, /buildFacts: z\.boolean\(\)\.default\(false\)/);
  assert.match(config, /buildFactsIssues\(d\)/, 'the projects schema runs the refinement');
});

test("package.json's test script runs TEST_GLOB verbatim", () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(pkg.scripts.test.includes(TEST_GLOB), `${pkg.scripts.test} contains ${TEST_GLOB}`);
});

// Static copy keeps no counted figures: the page computes them (#287).
const NUMBER = '\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
const COUNTED = '(?:ADRs?|architecture decision records?|decision records?|test files?|tests?|commits?|pull requests?|PRs?)';
const HARD_COUNT = new RegExp(`\\b(?:${NUMBER})\\b(?:\\s+[\\w-]+){0,3}?\\s+${COUNTED}\\b`, 'i');

test('the hard-coded count pattern catches the shapes it must', () => {
  for (const s of ['The six ADRs are in docs/adr/.', 'Six ADRs record why', '74 test files', '116 merged pull requests', '143 of 158 commits', 'twenty PRs', '7 architecture decision records']) {
    assert.match(s, HARD_COUNT, s);
  }
  for (const s of ['ADR 0001', 'The ADRs are in docs/adr/.', 'renders one frame and stops', 'a second workflow re-enables the deploy']) {
    assert.doesNotMatch(s, HARD_COUNT, s);
  }
});

test('pearse-dev.md hard-codes no count of ADRs, test files, commits or pull requests', () => {
  const src = readFileSync('src/content/projects/pearse-dev.md', 'utf8');
  const hit = src.match(HARD_COUNT);
  assert.equal(hit, null, `hard-coded count: "${hit?.[0]}"`);
  assert.match(src, /^buildFacts: true$/m);
});
