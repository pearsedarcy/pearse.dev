// Headline figures (#286, GLOSSARY "Figure"): the table in src/lib/figures.ts against the copy.
// The parser and checker are loaded through Node type stripping. The scan reads source files
// (src/content/**, src/pages/**/*.astro, src/components/**/*.astro, docs/profile/*.md); the
// pearse.dev ADR figure is counted from docs/adr/ at run time, and its only statement is the
// build-facts sentence, so the last test reads dist/ (`npm test`'s pretest build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADR_FILE,
  CLAIMS,
  DERIVED,
  FIGURES,
  IGNORED,
  PRODUCTS,
  RENDERED,
  aboutTolerance,
  agrees,
  figureIssues,
  measureOf,
  normaliseWhitespace,
  numberWordValue,
  parseCounts,
  resolveFigures,
} from '../src/lib/figures.ts';
import { projects } from './lib/projects.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

/** ADR files in `dir`, by the same rule as the build facts (ADR_FILE). */
const countAdrFiles = (dir) => readdirSync(dir).filter((f) => ADR_FILE.test(f)).length;

/** Repo-relative paths of every file under `dir` whose name passes `keep`. */
const filesUnder = (dir, keep = () => true) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && keep(e.name))
    .map((e) => join(e.parentPath, e.name));

/** The scanned copy: path -> raw text. */
function scannedFiles() {
  const astro = (n) => n.endsWith('.astro');
  const paths = [
    ...filesUnder('src/content'),
    ...filesUnder('src/pages', astro),
    ...filesUnder('src/components', astro),
    ...readdirSync('docs/profile').filter((f) => f.endsWith('.md')).map((f) => `docs/profile/${f}`),
  ];
  return new Map(paths.sort().map((p) => [p, readFileSync(p, 'utf8')]));
}

const repoValues = () => resolveFigures({ 'docs/adr': countAdrFiles('docs/adr') });

/** The one count in `text`, asserted. */
function one(text) {
  const found = parseCounts(text);
  assert.equal(found.length, 1, `"${text}": expected one count, got ${JSON.stringify(found)}`);
  return found[0];
}

// --- the parser -----------------------------------------------------------------------------

test('parses every phrase the scan must match to its number, relation and measure', () => {
  for (const [text, n, relation, measure] of [
    ['6000+ tests', 6000, 'atLeast', 'tests'],
    ['more than 6000 automated tests', 6000, 'atLeast', 'tests'],
    ['22 written architecture decision records', 22, 'eq', 'adrs'],
    ['1,086 commits', 1086, 'eq', 'commits'],
    ['about 490 test files', 490, 'about', 'test-files'],
    ['five short ADRs', 5, 'eq', 'adrs'],
    ['Six ADRs', 6, 'eq', 'adrs'],
    ['Fifty-plus ADRs', 50, 'atLeast', 'adrs'],
  ]) {
    const m = one(text);
    assert.deepEqual({ text: m.text, n: m.n, relation: m.relation, measure: m.measure }, { text, n, relation, measure }, text);
  }
});

test('reads every hedge and suffix, number words and thousands commas', () => {
  for (const [text, n, relation] of [
    ['around 490 test files', 490, 'about'],
    ['roughly 40 commits', 40, 'about'],
    ['~490 test files', 490, 'about'],
    ['~ 490 test files', 490, 'about'],
    ['over 900 commits', 900, 'atLeast'],
    ['at least 20 ADRs', 20, 'atLeast'],
    ['Forty-plus ADRs', 40, 'atLeast'],
    ['twenty-two self-hosted tests', 22, 'eq'],
    ['Seventeen commits', 17, 'eq'],
    ['12,000 tests', 12000, 'eq'],
    ['6000 tests', 6000, 'eq'],
  ]) {
    const m = one(text);
    assert.deepEqual([m.n, m.relation], [n, relation], text);
  }
});

test('matches a phrase wrapped across lines, and indexes the normalised text', () => {
  const wrapped = 'with\n  about 490\n  test\tfiles including';
  const m = one(wrapped);
  assert.equal(m.text, 'about 490 test files');
  assert.equal(normaliseWhitespace(wrapped).slice(m.index, m.index + m.text.length), m.text);
});

test('needs a number on a word boundary, a plural noun and at most one word between them', () => {
  for (const text of ['The ADRs are in docs/adr/.', 'the tests read dist/', 'v2 tests', 'one ADR', '22 more short ADRs', 'tests: 22', 'contests 22 commitments']) {
    assert.deepEqual(parseCounts(text), [], text);
  }
  assert.equal(one('twenty-two ADRs').n, 22, 'the "two" of "twenty-two" is not a second count');
  assert.equal(parseCounts('939 commits, 6000+ tests, 22 ADRs').length, 3);
});

test('number words run from one to ninety-nine', () => {
  assert.equal(numberWordValue('one'), 1);
  assert.equal(numberWordValue('nineteen'), 19);
  assert.equal(numberWordValue('Forty'), 40);
  assert.equal(numberWordValue('ninety-nine'), 99);
  assert.equal(numberWordValue('hundred'), undefined);
  assert.equal(numberWordValue('ten-two'), undefined);
});

test('eq, atLeast and about agree by the rules', () => {
  const at = (text, value) => {
    const m = one(text);
    return agrees(m.relation, m.n, value);
  };
  assert.equal(aboutTolerance(44), 4);
  assert.equal(aboutTolerance(5), 1, 'never below 1');
  assert.equal(at('about 50 architecture decision records', 44), false, 'about 50 against 44: the gap is 6, allowed 4');
  assert.equal(at('about 48 ADRs', 44), true);
  assert.equal(at('more than 40 architecture decision records', 44), true);
  assert.equal(at('Forty-plus ADRs', 44), true);
  assert.equal(at('Fifty-plus ADRs', 44), false);
  assert.equal(at('6000 tests', 6000), true, 'bare 6000 against 6000');
  assert.equal(at('6001 tests', 6000), false);
  assert.equal(at('6000+ tests', 6000), true);
  assert.equal(at('Six ADRs', 7), false);
});

// --- the checker, on fixtures ---------------------------------------------------------------

test('a fixture docs/adr/ with eight ADRs counts 8 and reports "Seven ADRs" as a mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figures-'));
  try {
    const adr = join(dir, 'docs/adr');
    mkdirSync(adr, { recursive: true });
    for (let i = 1; i <= 8; i++) writeFileSync(join(adr, `${String(i).padStart(4, '0')}-decision-${i}.md`), '');
    writeFileSync(join(adr, 'README.md'), '');
    writeFileSync(join(adr, 'template.md'), '');
    const count = countAdrFiles(adr);
    assert.equal(count, 8);

    const pearse = FIGURES.find((f) => f.id === 'adrs.pearse-dev');
    const values = resolveFigures({ 'docs/adr': count }, [pearse], []);
    assert.equal(values.get('adrs.pearse-dev'), 8);
    const file = 'src/content/projects/pearse-dev.md';
    const issues = figureIssues({
      files: new Map([[file, 'hooks:\n  - Seven ADRs record why.']]),
      values,
      claims: [{ file, phrase: 'Seven ADRs', figure: 'adrs.pearse-dev' }],
      ignored: [],
      rendered: [],
    });
    assert.deepEqual(issues.map((i) => i.kind), ['mismatch']);
    assert.match(issues[0].message, /exactly 7, but adrs\.pearse-dev is 8/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** figureIssues over one fixture file and two figures, `{ kinds, messages }`. */
function check(text, { claims = [], ignored = [] } = {}) {
  const values = new Map([
    ['adrs.x', 44],
    ['tests.x', 6000],
  ]);
  const issues = figureIssues({ files: new Map([['f.md', text]]), values, claims, ignored, rendered: [] });
  return { kinds: issues.map((i) => i.kind).sort(), messages: issues.map((i) => i.message) };
}
const claim = (phrase, figure = 'adrs.x') => ({ file: 'f.md', phrase, figure });
const BOTH = (text) => [claim(text.adrs), claim(text.tests, 'tests.x')];

test('the checker passes copy whose every count is claimed and agrees', () => {
  const text = 'More than 40 ADRs\nand 6000+ tests.';
  assert.deepEqual(check(text, { claims: BOTH({ adrs: 'More than 40 ADRs', tests: '6000+ tests' }) }).kinds, []);
});

test('the checker reports a count that is neither claimed nor ignored', () => {
  const text = 'More than 40 ADRs and 6000+ tests, from 18 commits.';
  const r = check(text, { claims: BOTH({ adrs: 'More than 40 ADRs', tests: '6000+ tests' }) });
  assert.deepEqual(r.kinds, ['unregistered']);
  assert.match(r.messages[0], /f\.md: "18 commits"/);
  const ignored = [{ file: 'f.md', phrase: '18 commits', reason: 'another product' }];
  assert.deepEqual(check(text, { claims: BOTH({ adrs: 'More than 40 ADRs', tests: '6000+ tests' }), ignored }).kinds, []);
});

test('the checker reports a claim that disagrees, or that names the wrong measure', () => {
  assert.deepEqual(check('about 50 ADRs and 6000+ tests', { claims: BOTH({ adrs: 'about 50 ADRs', tests: '6000+ tests' }) }).kinds, ['mismatch']);
  assert.deepEqual(check('44 ADRs and 6000+ tests', { claims: [claim('44 ADRs'), claim('6000+ tests')] }).kinds, ['no-claim', 'wrong-measure']);
});

test('the checker reports a missing phrase, a repeated phrase and a phrase without exactly one count', () => {
  const tests = claim('6000+ tests', 'tests.x');
  assert.deepEqual(check('44 ADRs. 6000+ tests.', { claims: [claim('45 ADRs'), tests] }).kinds, ['missing-phrase', 'unregistered']);
  assert.deepEqual(check('44 ADRs. 6000+ tests. 44 ADRs.', { claims: [claim('44 ADRs'), tests] }).kinds, ['duplicate-phrase', 'unregistered', 'unregistered']);
  assert.deepEqual(check('44 ADRs, 6000+ tests.', { claims: [claim('44 ADRs, 6000+ tests'), tests] }).kinds, ['phrase-count', 'unregistered']);
  assert.deepEqual(check('the 44 ADRs, 6000+ tests.', { claims: [claim('the 44'), tests] }).kinds, ['phrase-count', 'unregistered']);
  const ignored = [{ file: 'f.md', phrase: '9 commits', reason: 'gone' }];
  assert.deepEqual(check('44 ADRs. 6000+ tests.', { claims: [claim('44 ADRs'), tests], ignored }).kinds, ['missing-phrase']);
  assert.deepEqual(check('44 ADRs. 6000+ tests.', { claims: [claim('44 ADRs'), tests, { ...tests, file: 'g.md' }] }).kinds, ['no-file']);
});

test('the checker reports a figure no claim states, and a claim on an unknown figure', () => {
  assert.deepEqual(check('44 ADRs.', { claims: [claim('44 ADRs')] }).kinds, ['no-claim']);
  assert.deepEqual(check('44 ADRs. 6000+ tests.', { claims: [claim('44 ADRs'), claim('6000+ tests', 'tests.y')] }).kinds, ['no-claim', 'unknown-figure', 'unregistered']);
});

test('the checker reports one count both claimed and ignored', () => {
  const ignored = [{ file: 'f.md', phrase: '6000+ tests', reason: 'twice' }];
  assert.deepEqual(check('44 ADRs. 6000+ tests.', { claims: [claim('44 ADRs'), claim('6000+ tests', 'tests.x')], ignored }).kinds, ['double-entry']);
});

// --- the table ------------------------------------------------------------------------------

test('figure ids are unique, name a measure and their product, and every derived figure sums known MTS figures', () => {
  const ids = [...FIGURES.map((f) => f.id), ...DERIVED.map((d) => d.id)];
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const f of FIGURES) {
    assert.ok(PRODUCTS.includes(f.product), `${f.id}: product`);
    assert.equal(f.id, `${measureOf(f.id)}.${f.product}`, `${f.id}: id is <measure>.<product>`);
    assert.ok(['adrs', 'tests', 'test-files', 'commits'].includes(measureOf(f.id)), `${f.id}: measure`);
    assert.ok((f.value === undefined) !== (f.counted === undefined), `${f.id}: exactly one of value and counted`);
    if (f.value !== undefined) assert.ok(Number.isInteger(f.value) && f.value > 0, `${f.id}: positive integer`);
  }
  for (const d of DERIVED) {
    assert.ok(d.sumOf.length >= 2, `${d.id}: sums at least two figures`);
    for (const id of d.sumOf) {
      const f = FIGURES.find((x) => x.id === id);
      assert.ok(f, `${d.id}: ${id} is a figure`);
      assert.equal(measureOf(id), measureOf(d.id), `${d.id}: ${id} has the same measure`);
      assert.notEqual(f.product, 'pearse-dev', `${d.id}: pearse.dev is never summed into an MTS figure`);
    }
  }
  const values = repoValues();
  assert.equal(values.get('adrs.mts'), 44, 'adrs.mts is MTS Hub plus wetlabs.app');
  assert.equal(values.get('adrs.pearse-dev'), countAdrFiles('docs/adr'), 'counted from docs/adr/');
});

test('every figure has a valid month, and a method that names nothing confidential', () => {
  const now = new Date().toISOString().slice(0, 7);
  for (const f of FIGURES) {
    assert.match(f.asOf, /^\d{4}-(0[1-9]|1[0-2])$/, `${f.id}: asOf is YYYY-MM`);
    assert.ok(f.asOf <= now, `${f.id}: asOf is not in the future`);
    assert.match(f.method, /^[A-Z].{15,}\.$/, `${f.id}: method is a sentence`);
    assert.doesNotMatch(f.method, /runner|server|host\b|https?:|@|\b\d{1,3}(\.\d{1,3}){3}\b|github/i, `${f.id}: method names no runner, host, address or link`);
  }
  for (const i of IGNORED) assert.ok(i.reason.length >= 10, `ignored "${i.phrase}" in ${i.file}: give a reason`);
});

// --- the repo -------------------------------------------------------------------------------

test('every count in the copy is claimed or ignored, every claim agrees, and every figure is stated', () => {
  const files = scannedFiles();
  assert.ok(files.size > 40, `scanned only ${files.size} files`);
  for (const p of ['src/pages/index.astro', 'docs/profile/linkedin.md', 'src/content/social/p02.md']) assert.ok(files.has(p), `${p} is scanned`);
  const issues = figureIssues({ files, values: repoValues() });
  assert.deepEqual(issues.map((i) => i.message), []);
  assert.ok(CLAIMS.length > 0 && IGNORED.length > 0);
});

test('every outcomes value on MTS Hub and wetlabs.app parses to its figure', () => {
  const values = repoValues();
  const checked = [];
  for (const p of projects().filter((x) => x.slug === 'mts-hub' || x.slug === 'wetlabs-app')) {
    for (const { value, label } of p.outcomes ?? []) {
      const text = `${value} ${label}`;
      const m = one(text);
      assert.equal(m.text, text, `${p.slug}: "${text}" is one whole count`);
      const id = `${m.measure}.${p.slug}`;
      assert.ok(values.has(id), `${p.slug}: "${text}" has no figure ${id}`);
      assert.ok(agrees(m.relation, m.n, values.get(id)), `${p.slug}: "${text}" disagrees with ${id} = ${values.get(id)}`);
      checked.push(`${p.slug} ${value}`);
    }
  }
  assert.deepEqual(checked.sort(), ['mts-hub 22', 'mts-hub 6000+', 'wetlabs-app 22', 'wetlabs-app ~490']);
});

const OUTCOMES_ROW = /<dl class="case-outcomes"[\s\S]*?<\/dl>/;

/**
 * The counts a built page states: each outcomes item read as "value label" (the row renders the
 * label first), then the rest of the visible text with the row taken out.
 */
function pageCounts(path) {
  const html = readFileSync(path, 'utf8');
  const row = html.match(OUTCOMES_ROW)?.[0] ?? '';
  const items = [...row.matchAll(/<dt[^>]*>([^<]*)<\/dt>\s*<dd[^>]*>([^<]*)<\/dd>/g)].map(([, label, value]) => `${value} ${label}`);
  const rest = html
    .replace(OUTCOMES_ROW, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return [...items.flatMap(parseCounts), ...parseCounts(rest)];
}

test('a figure the build renders (build facts) agrees with its figure on the built page', () => {
  const values = repoValues();
  assert.ok(RENDERED.length > 0);
  for (const { figure, page } of RENDERED) {
    const stated = pageCounts(page).filter((m) => m.measure === measureOf(figure));
    assert.ok(stated.length >= 2, `${page}: expected the outcomes item and the build-facts sentence to state ${figure}`);
    assert.ok(stated.length > 0, `${page} states no ${measureOf(figure)} count for ${figure}`);
    for (const m of stated) {
      assert.ok(agrees(m.relation, m.n, values.get(figure)), `${page}: "${m.text}", but ${figure} is ${values.get(figure)} (rebuild, or check the build facts)`);
    }
  }
});
