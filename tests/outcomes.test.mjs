// Case-study outcomes (#159): the `outcome` sentence and the `outcomes` engineering-metrics row.
// The pure validator (src/lib/outcomes.ts) is loaded directly through Node type stripping; the
// allowlist reads source frontmatter; the rendered and CSS checks read dist/ and rely on
// `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BUSINESS_COUNT_WORDS,
  OUTCOME_LABEL_MAX,
  OUTCOME_MAX,
  OUTCOME_VALUE_MAX,
  OUTCOMES_MAX,
  outcomeIssues,
} from '../src/lib/outcomes.ts';
import { VERIFY_MARKER } from '../src/lib/verify-marker.ts';
import { projects } from './lib/projects.mjs';
import { parseHtml, find, text, hasClass } from './lib/html.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

// Every committed `outcomes` row, figure for figure. Each sourcePhrase is already published in
// that case study's own frontmatter copy (hooks, features or sections), so the row adds no new
// figure. A new or changed figure is always a reviewed edit to this list (GLOSSARY "Outcome").
const ALLOWLIST = {
  // src/content/projects/mts-hub.md, hooks[1]
  'mts-hub': [
    { value: '6000+', label: 'automated tests', sourcePhrase: '6000+ automated tests' },
    { value: '22', label: 'architecture decision records', sourcePhrase: '22 written architecture decision records' },
  ],
  // src/content/projects/wetlabs-app.md, hooks[1]
  'wetlabs-app': [
    { value: '22', label: 'ADRs', sourcePhrase: '22 ADRs' },
    { value: '~490', label: 'test files', sourcePhrase: 'around 490 test files' },
  ],
};

const item = (value = '22', label = 'ADRs') => ({ value, label });
const paths = (fields) => outcomeIssues(fields).map((i) => i.path);
const rejects = (fields, path, what) => assert.ok(paths(fields).includes(path), `${what}: expected an issue at ${path}, got ${JSON.stringify(paths(fields))}`);
const accepts = (fields, what) => assert.deepEqual(outcomeIssues(fields), [], what);

// --- the pure validator -------------------------------------------------------------------

test('absent fields and the committed content have no issues', () => {
  accepts({}, 'no fields');
  accepts({ outcome: undefined, outcomes: undefined }, 'undefined fields');
  for (const p of projects()) accepts({ outcome: p.outcome, outcomes: p.outcomes }, p.slug);
});

test('rejects currency symbols and codes in any field', () => {
  rejects({ outcomes: [item('€40k')] }, 'outcomes.0.value', '€ in value');
  rejects({ outcomes: [item(), item('$5', 'tests')] }, 'outcomes.1.value', '$ in value');
  rejects({ outcomes: [item('22', 'EUR saved')] }, 'outcomes.0.label', 'EUR in label');
  rejects({ outcome: 'Cheaper in GBP than the old tools.' }, 'outcome', 'GBP in outcome');
  rejects({ outcome: 'Saved £ on hosting.' }, 'outcome', '£ in outcome');
  rejects({ outcomes: [item('¥', 'tests')] }, 'outcomes.0.value', '¥ in value');
  rejects({ outcomes: [item('22', 'usd per run')] }, 'outcomes.0.label', 'usd, any case');
});

test('rejects % in any field', () => {
  rejects({ outcomes: [item('90%', 'coverage')] }, 'outcomes.0.value', '% in value');
  rejects({ outcomes: [item('22', '% covered')] }, 'outcomes.0.label', '% in label');
  rejects({ outcome: 'Most of the work, by %, is automated.' }, 'outcome', '% in outcome');
});

test('rejects the verify marker in any field, and never echoes it', () => {
  const marked = `${VERIFY_MARKER}: check]`;
  for (const [fields, path] of [
    [{ outcome: `Faster ${marked}` }, 'outcome'],
    [{ outcomes: [item(), item(marked, 'tests')] }, 'outcomes.1.value'],
    [{ outcomes: [item('22', `tests ${marked}`)] }, 'outcomes.0.label'],
  ]) {
    rejects(fields, path, `marker at ${path}`);
    for (const { message } of outcomeIssues(fields)) {
      assert.ok(!message.includes(VERIFY_MARKER), `message does not echo the marker: ${message}`);
      assert.ok(message.startsWith(`${path}:`) || message.startsWith('outcomes:'), `message names the path: ${message}`);
    }
  }
});

test('rejects any digit in outcome', () => {
  rejects({ outcome: 'Three tools became 1.' }, 'outcome', 'digit in outcome');
  accepts({ outcome: 'Three tools became one.' }, 'number words are fine');
});

test('rejects business-count words in label, as whole words in any case', () => {
  rejects({ outcomes: [item('22', 'customers')] }, 'outcomes.0.label', 'customers');
  for (const word of BUSINESS_COUNT_WORDS) {
    rejects({ outcomes: [item('22', `happy ${word.toUpperCase()}`)] }, 'outcomes.0.label', word);
  }
  accepts({ outcomes: [item('22', 'user-agent checks')] }, 'not a whole-word match');
  accepts({ outcomes: [item('22', 'reorders handled')] }, 'a word containing "orders"');
});

test('length and count caps reject one over and accept the boundary', () => {
  rejects({ outcomes: [item('x'.repeat(OUTCOME_VALUE_MAX + 1))] }, 'outcomes.0.value', 'value of 9');
  rejects({ outcomes: [item('22', 'x'.repeat(OUTCOME_LABEL_MAX + 1))] }, 'outcomes.0.label', 'label of 41');
  rejects({ outcome: 'x'.repeat(OUTCOME_MAX + 1) }, 'outcome', 'outcome of 161');
  rejects({ outcomes: [] }, 'outcomes', '0 items');
  rejects({ outcomes: Array.from({ length: OUTCOMES_MAX + 1 }, () => item()) }, 'outcomes', '5 items');

  assert.equal(OUTCOME_VALUE_MAX, 8);
  assert.equal(OUTCOME_LABEL_MAX, 40);
  assert.equal(OUTCOME_MAX, 160);
  assert.equal(OUTCOMES_MAX, 4);
  accepts({ outcomes: [item('x'.repeat(8))] }, 'value of exactly 8');
  accepts({ outcomes: [item('22', 'x'.repeat(40))] }, 'label of exactly 40');
  accepts({ outcome: 'x'.repeat(160) }, 'outcome of exactly 160');
  accepts({ outcomes: Array.from({ length: 4 }, () => item()) }, '4 items');
});

test('outcomes.ts imports only the pure verify-marker module, with an explicit extension', () => {
  const src = readFileSync('src/lib/outcomes.ts', 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./verify-marker.ts']);
  assert.doesNotMatch(src, /\[VERIFY/, 'the marker is imported, not defined again');
});

// --- the figure allowlist -----------------------------------------------------------------

const copy = (p) =>
  [
    ...(p.hooks ?? []),
    ...(p.features ?? []),
    ...(p.sections ?? []).flatMap((s) => [s.title, s.origin, s.summary, ...(s.features ?? [])]),
  ]
    .filter((s) => typeof s === 'string')
    .join('\n');

test('every committed outcomes row equals its allowlist entry, figure for figure', () => {
  const withRows = projects().filter((p) => p.outcomes !== undefined);
  assert.deepEqual(withRows.map((p) => p.slug).sort(), Object.keys(ALLOWLIST).sort(), 'exactly the allowlisted case studies have outcomes');
  for (const p of withRows) {
    const expected = ALLOWLIST[p.slug].map(({ value, label }) => ({ value, label }));
    assert.deepEqual(p.outcomes, expected, `${p.slug}: outcomes match the allowlist`);
  }
});

test("every allowlist sourcePhrase is in that case study's own source copy", () => {
  const bySlug = Object.fromEntries(projects().map((p) => [p.slug, p]));
  for (const [slug, entries] of Object.entries(ALLOWLIST)) {
    const own = copy(bySlug[slug]);
    for (const { value, sourcePhrase } of entries) {
      assert.ok(own.includes(sourcePhrase), `${slug}: "${sourcePhrase}" is in its hooks, features or sections`);
      // The value keeps the page's own hedging: `~490` for "around 490", never a bare figure.
      const digits = value.replace(/\D/g, '');
      assert.ok(sourcePhrase.includes(digits), `${slug}: ${value} restates ${sourcePhrase}`);
    }
  }
});

// --- rendering ----------------------------------------------------------------------------

const read = (path) => readFileSync(path, 'utf8');
const dlsWithClass = (html, cls) => html.match(new RegExp(`<dl[^>]*class="[^"]*\\b${cls}\\b`, 'g')) ?? [];

test('MTS Hub header: title, outcome, one-liner, facts, then the outcomes row', () => {
  const html = read('dist/work/mts-hub/index.html');
  const hub = projects().find((p) => p.slug === 'mts-hub');
  const h1 = html.indexOf('<h1');
  const outcome = html.indexOf(hub.outcome);
  const oneLiner = html.indexOf(hub.oneLiner.replace(/&/g, '&amp;'));
  assert.ok(h1 > 0 && outcome > h1, 'outcome after the h1');
  assert.ok(oneLiner > outcome, 'outcome before the one-liner');
  const facts = html.search(/<dl[^>]*class="[^"]*\bcase-facts\b/);
  const row = html.search(/<dl[^>]*class="[^"]*\bcase-outcomes\b/);
  assert.ok(facts > oneLiner, 'facts after the one-liner');
  assert.ok(row > facts, 'outcomes row after the facts');
  const stack = html.search(/<ul[^>]*class="[^"]*\bcase-stack\b/);
  assert.ok(stack > row, 'outcomes row before the stack chips');

  const [dl] = find(parseHtml(html), (el) => el.tag === 'dl' && hasClass(el, 'case-outcomes'));
  const items = find(dl, (el) => el.tag === 'div');
  assert.deepEqual(
    items.map((div) => div.children.filter((c) => typeof c !== 'string').map((c) => [c.tag, text(c).trim()])),
    [
      [['dt', 'automated tests'], ['dd', '6000+']],
      [['dt', 'architecture decision records'], ['dd', '22']],
    ],
    'label in dt, value in dd, dt first in source order',
  );
});

test('wetlabs.app has the outcomes row; a case study without outcomes has none', () => {
  const html = read('dist/work/wetlabs-app/index.html');
  assert.equal(dlsWithClass(html, 'case-outcomes').length, 1);
  const [dl] = find(parseHtml(html), (el) => el.tag === 'dl' && hasClass(el, 'case-outcomes'));
  const dds = find(dl, (el) => el.tag === 'dd').map((el) => text(el).trim());
  assert.deepEqual(dds, ['22', '~490']);
  assert.doesNotMatch(html, /class="case-outcome"/, 'no outcome sentence on wetlabs.app');

  assert.equal(dlsWithClass(read('dist/work/mx-creative-keypad/index.html'), 'case-outcomes').length, 0);
  for (const p of projects().filter((x) => x.caseStudy && !x.outcomes)) {
    assert.equal(dlsWithClass(read(`dist/work/${p.slug}/index.html`), 'case-outcomes').length, 0, p.slug);
  }
});

test('home shows two card-outcomes rows, one per large MTS card; /work/ shows none', () => {
  const home = read('dist/index.html');
  assert.equal(dlsWithClass(home, 'card-outcomes').length, 2);
  const cards = find(parseHtml(home), (el) => el.tag === 'a' && hasClass(el, 'card'));
  const withRow = cards.filter((a) => find(a, (el) => el.tag === 'dl' && hasClass(el, 'card-outcomes')).length > 0);
  assert.deepEqual(withRow.map((a) => a.attrs.href), ['/work/mts-hub/', '/work/wetlabs-app/']);
  for (const a of withRow) {
    assert.ok(hasClass(a, 'card-lg'), `${a.attrs.href} is a large card`);
    assert.equal(find(a, (el) => el.tag === 'dd').length, 2, `${a.attrs.href} shows two outcomes`);
  }
  assert.equal(dlsWithClass(read('dist/work/index.html'), 'card-outcomes').length, 0);
});

test('the outcomes row is 2 columns on phones, 4 from 48rem, and cannot overflow', () => {
  const html = read('dist/work/mts-hub/index.html');
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  // The base rule sits outside any media query: strip the @media blocks first.
  const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  assert.match(base, /\.case-outcomes[^{\s]*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, '2 columns by default');
  // Astro's CSS minifier may rewrite (min-width: 48rem) as the range form (width>=48rem).
  assert.match(
    css,
    /@media[^{]*(?:min-width:\s*|width\s*>=\s*)48rem[^{]*\{[^@]*?\.case-outcomes[^{\s]*\{[^}]*grid-template-columns:\s*repeat\(4/,
    '4 columns inside a min-width media query',
  );
  assert.match(css, /\.case-outcomes[^{]*\bdiv[^{]*\{[^}]*min-width:\s*0/, 'items can shrink');
  assert.match(css, /\.case-outcomes[^{]*\bdd[^{]*\{[^}]*overflow-wrap:\s*anywhere/, 'values wrap rather than overflow');
});
