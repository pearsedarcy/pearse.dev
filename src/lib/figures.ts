// Headline figures (#286, GLOSSARY "Figure"): one typed table of the counts the site states about
// its three tracked products (MTS Hub, wetlabs.app and pearse.dev), the claims that state them,
// the counts that are about something else, and the parser and checker that keep copy and table
// in agreement. tests/figures.test.mjs scans the copy and fails on any count that is neither a
// claim nor ignored, or that disagrees with its figure.
//
// Pure: the tests load it through Node type stripping, so imports carry explicit `.ts`
// extensions and nothing here may import astro:content, ./site or ./diagrams.
//
// Confidentiality (ADR 0005): figures for private repositories are counts only. A `method` says
// how a figure was measured and names no runner, host, address, customer, congress or repository.
import { ADR_FILE } from './build-facts.ts';

export { ADR_FILE };

/** The three products whose figures the site tracks. pearse.dev is never summed into an MTS figure. */
export const PRODUCTS = ['mts-hub', 'wetlabs-app', 'pearse-dev'] as const;
export type Product = (typeof PRODUCTS)[number];

/** What a count counts, read from the noun that follows the number. */
export type Measure = 'adrs' | 'tests' | 'test-files' | 'commits';

/** A source the tests count at run time instead of a stored value. */
export type CountedSource = 'docs/adr';

interface FigureBase {
  /** `<measure>.<product>`; the measure must match the noun of every claim against it. */
  id: string;
  product: Product;
  /** Month the figure was measured, `YYYY-MM`. */
  asOf: `${number}-${number}`;
  /** How the figure was measured, in words a reader can follow. Names nothing confidential. */
  method: string;
}

/** A stored figure, or one the tests count from the checkout (`counted`). */
export type Figure = FigureBase & ({ value: number; counted?: undefined } | { counted: CountedSource; value?: undefined });

/** A figure that is the sum of other figures. */
export interface DerivedFigure {
  id: string;
  sumOf: readonly BaseFigureId[];
}

export const FIGURES = [
  {
    id: 'commits.mts-hub',
    product: 'mts-hub',
    value: 939,
    asOf: '2026-10',
    method: 'Commits on the main branch of the private repository, counted from its git history.',
  },
  {
    id: 'tests.mts-hub',
    product: 'mts-hub',
    value: 6000,
    asOf: '2026-10',
    method: 'Automated tests in the private repository, counted and stored as a round lower bound.',
  },
  {
    id: 'adrs.mts-hub',
    product: 'mts-hub',
    value: 22,
    asOf: '2026-10',
    method: 'ADR files in the private repository, counted.',
  },
  {
    id: 'commits.wetlabs-app',
    product: 'wetlabs-app',
    value: 1086,
    asOf: '2026-10',
    method: 'Commits in the private repository, counted from its git history.',
  },
  {
    id: 'test-files.wetlabs-app',
    product: 'wetlabs-app',
    value: 490,
    asOf: '2026-10',
    method: 'Test files in the private repository, counted and rounded to the nearest 10.',
  },
  {
    id: 'adrs.wetlabs-app',
    product: 'wetlabs-app',
    value: 22,
    asOf: '2026-10',
    method: 'ADR files in the private repository, counted.',
  },
  {
    id: 'adrs.pearse-dev',
    product: 'pearse-dev',
    counted: 'docs/adr',
    asOf: '2026-11',
    method: "ADR files in docs/adr/ of this site's public repository, counted when the tests run.",
  },
] as const satisfies readonly Figure[];

export type BaseFigureId = (typeof FIGURES)[number]['id'];

export const DERIVED = [
  // MTS Hub and wetlabs.app only: pearse.dev is never summed into an MTS figure.
  { id: 'adrs.mts', sumOf: ['adrs.mts-hub', 'adrs.wetlabs-app'] },
] as const satisfies readonly DerivedFigure[];

export type FigureId = BaseFigureId | (typeof DERIVED)[number]['id'];

/**
 * A count in published copy and the figure it states. `phrase` occurs exactly once in the file's
 * whitespace-normalised text and contains exactly one count; lengthen it to break a tie. The
 * relation (exact, at least, about) is read from the text, never declared here.
 */
export interface Claim {
  file: string;
  phrase: string;
  figure: FigureId;
}

/** A count about something other than the three tracked products, with the reason it is not a claim. */
export interface Ignored {
  file: string;
  phrase: string;
  reason: string;
}

/**
 * A figure no copy states because the build computes and renders it (build facts, #287). The
 * tests check the built page's count against the figure instead.
 */
export interface Rendered {
  figure: FigureId;
  page: string;
}

const HUB = 'src/content/projects/mts-hub.md';
const WETLABS = 'src/content/projects/wetlabs-app.md';
const ONE_ENGINEER = 'src/content/posts/one-engineer-one-platform.md';
const CONGRESS = 'src/content/posts/shipping-a-video-platform-to-a-congress.md';
const CV = 'src/content/cv/cv.md';
const BIO = 'docs/profile/bio.md';
const LINKEDIN = 'docs/profile/linkedin.md';
const P02 = 'src/content/social/p02.md';

/** Every count in the scanned copy that states a tracked figure. */
export const CLAIMS: readonly Claim[] = [
  // MTS Hub case study, hooks
  { file: HUB, phrase: '6000+ automated tests and', figure: 'tests.mts-hub' },
  { file: HUB, phrase: '22 written architecture decision records', figure: 'adrs.mts-hub' },
  // wetlabs.app case study, hooks
  { file: WETLABS, phrase: '22 ADRs, around', figure: 'adrs.wetlabs-app' },
  { file: WETLABS, phrase: 'around 490 test files', figure: 'test-files.wetlabs-app' },
  // MTS Hub article: description, LinkedIn copy, short copy, body
  { file: ONE_ENGINEER, phrase: 'sole engineer: 939 commits', figure: 'commits.mts-hub' },
  { file: ONE_ENGINEER, phrase: 'commits, 6000+ tests, 22', figure: 'tests.mts-hub' },
  { file: ONE_ENGINEER, phrase: '22 ADRs, and an agent team', figure: 'adrs.mts-hub' },
  { file: ONE_ENGINEER, phrase: 'One engineer. 939 commits.', figure: 'commits.mts-hub' },
  { file: ONE_ENGINEER, phrase: '6000+ tests. Four months.', figure: 'tests.mts-hub' },
  { file: ONE_ENGINEER, phrase: '22 architecture decision records, each one short', figure: 'adrs.mts-hub' },
  { file: ONE_ENGINEER, phrase: 'short: "939 commits', figure: 'commits.mts-hub' },
  { file: ONE_ENGINEER, phrase: '6000+ tests, one engineer', figure: 'tests.mts-hub' },
  { file: ONE_ENGINEER, phrase: 'stands at 939 commits', figure: 'commits.mts-hub' },
  { file: ONE_ENGINEER, phrase: 'more than 6000 automated tests', figure: 'tests.mts-hub' },
  { file: ONE_ENGINEER, phrase: '22 written architecture decision records', figure: 'adrs.mts-hub' },
  // wetlabs.app article
  { file: CONGRESS, phrase: '1,086 commits', figure: 'commits.wetlabs-app' },
  { file: CONGRESS, phrase: 'about 490 test files', figure: 'test-files.wetlabs-app' },
  // pearse.dev article and the tournament-brackets row: MTS Hub's suite
  { file: 'src/content/posts/why-i-rebuilt-pearse-dev.md', phrase: 'with 6000 tests', figure: 'tests.mts-hub' },
  { file: 'src/content/projects/tournament-brackets.md', phrase: 'a platform with 6000 tests', figure: 'tests.mts-hub' },
  // CV, MTS Hub role
  { file: CV, phrase: '6000+ tests and a first live event', figure: 'tests.mts-hub' },
  { file: CV, phrase: 'Wrote 22 ADRs', figure: 'adrs.mts-hub' },
  { file: CV, phrase: '6000+ automated tests', figure: 'tests.mts-hub' },
  // Standalone posts
  { file: P02, phrase: 'short: "There are more than 40 architecture decision records', figure: 'adrs.mts' },
  { file: P02, phrase: 'more than 40 architecture decision records across MTS Hub and wetlabs.app, the two products I build. Most', figure: 'adrs.mts' },
  { file: 'src/content/social/p12.md', phrase: '6000+ tests', figure: 'tests.mts-hub' },
  // Home page, "Decisions written down" theme: MTS only, pearse.dev excluded on purpose
  { file: 'src/pages/index.astro', phrase: 'Forty-plus ADRs across MTS Hub and wetlabs.app', figure: 'adrs.mts' },
  // Profile drafts (docs/profile/)
  { file: BIO, phrase: 'with more than 6000 automated tests', figure: 'tests.mts-hub' },
  { file: BIO, phrase: 'carries more than 6000 automated tests', figure: 'tests.mts-hub' },
  { file: BIO, phrase: '22 architecture decision records', figure: 'adrs.mts-hub' },
  { file: LINKEDIN, phrase: 'of mine. 6000+ tests', figure: 'tests.mts-hub' },
  { file: LINKEDIN, phrase: '22 ADRs, and a human-approval', figure: 'adrs.mts-hub' },
  { file: LINKEDIN, phrase: '939 commits', figure: 'commits.mts-hub' },
  { file: LINKEDIN, phrase: '6000+ tests and a first live event', figure: 'tests.mts-hub' },
  { file: LINKEDIN, phrase: 'Wrote 22 ADRs', figure: 'adrs.mts-hub' },
  { file: LINKEDIN, phrase: '6000+ automated tests', figure: 'tests.mts-hub' },
  { file: LINKEDIN, phrase: 'Set up 22 ADRs', figure: 'adrs.wetlabs-app' },
  { file: LINKEDIN, phrase: 'around 490 test files', figure: 'test-files.wetlabs-app' },
];

const KNOWLEDGE = "the knowledge feature's own early history, not a figure for MTS Hub as a whole";

/** Every count in the scanned copy that is about something other than the three tracked products. */
export const IGNORED: readonly Ignored[] = [
  { file: HUB, phrase: 'Five ADRs before the first feature', reason: KNOWLEDGE },
  { file: 'src/content/posts/a-second-brain-needs-a-schema.md', phrase: 'five short ADRs', reason: KNOWLEDGE },
  { file: 'src/content/social/p05.md', phrase: '18 commits', reason: KNOWLEDGE },
  { file: 'src/content/social/p05.md', phrase: 'five ADRs', reason: KNOWLEDGE },
  {
    file: 'src/content/social/p09.md',
    phrase: '26 commits',
    reason: 'the feedback tool as a standalone app, before it became a feature of MTS Hub',
  },
  {
    file: 'src/content/posts/wordpress-to-wagtail-without-breaking-the-business.md',
    phrase: 'about 96 commits',
    reason: 'a client build, not a tracked product',
  },
];

export const RENDERED: readonly Rendered[] = [{ figure: 'adrs.pearse-dev', page: 'dist/work/pearse-dev/index.html' }];

// --- the parser -----------------------------------------------------------------------------

/** Exact, at least (`+`, `-plus`, more than, over, at least) or about (about, around, roughly, `~`). */
export type Relation = 'eq' | 'atLeast' | 'about';

/** One count found in text: `index` and `text` refer to the whitespace-normalised text. */
export interface CountMatch {
  index: number;
  text: string;
  n: number;
  relation: Relation;
  measure: Measure;
}

/** Collapses every run of whitespace to one space, so a phrase wrapped across lines still matches. */
export const normaliseWhitespace = (s: string): string => s.replace(/\s+/g, ' ');

const ONES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER_WORD = `(?:${TENS.join('|')})(?:-(?:${ONES.join('|')}))?|${TEENS.join('|')}|${ONES.join('|')}`;

/** The value of a number word from one to ninety-nine (`fifty`, `twenty-two`), or undefined. */
export function numberWordValue(word: string): number | undefined {
  const [tens, ones] = word.toLowerCase().split('-');
  if (ones !== undefined) {
    const t = TENS.indexOf(tens!);
    const o = ONES.indexOf(ones);
    return t >= 0 && o >= 0 ? (t + 2) * 10 + o + 1 : undefined;
  }
  if (ONES.includes(tens!)) return ONES.indexOf(tens!) + 1;
  if (TEENS.includes(tens!)) return TEENS.indexOf(tens!) + 10;
  if (TENS.includes(tens!)) return (TENS.indexOf(tens!) + 2) * 10;
  return undefined;
}

const NOUNS: Record<string, Measure> = {
  'architecture decision records': 'adrs',
  adrs: 'adrs',
  'automated tests': 'tests',
  'test files': 'test-files',
  tests: 'tests',
  commits: 'commits',
};

const AT_LEAST = new Set(['more than', 'over', 'at least']);

// hedge? number suffix? adjective? noun, case-insensitive, on whole words. Never preceded by a
// word character, `.`, `,`, `~` or `-`, so "v2", "2.5" and the "two" of "twenty-two" never start one.
const COUNT = new RegExp(
  '(?<![\\w.,~-])' +
    '(?:(?<hedge>about|around|roughly|more than|over|at least) |(?<tilde>~) ?)?' +
    `(?<num>\\d{1,3}(?:,\\d{3})+|\\d+|${NUMBER_WORD})` +
    '(?<suffix>\\+|-plus)?' +
    ' (?:[a-z][a-z-]* )?' +
    `(?<noun>${Object.keys(NOUNS).join('|')})\\b`,
  'gi',
);

/** Every count in `text`, in order, with its number, relation and measure. */
export function parseCounts(text: string): CountMatch[] {
  const s = normaliseWhitespace(text);
  return [...s.matchAll(COUNT)].map((m) => {
    const g = m.groups!;
    const num = g.num!;
    const n = /^\d/.test(num) ? Number(num.replaceAll(',', '')) : numberWordValue(num)!;
    const hedge = g.hedge?.toLowerCase();
    const relation: Relation = g.suffix || (hedge && AT_LEAST.has(hedge)) ? 'atLeast' : hedge || g.tilde ? 'about' : 'eq';
    return { index: m.index, text: m[0], n, relation, measure: NOUNS[g.noun!.toLowerCase()]! };
  });
}

/** The gap an `about` count may have from its figure: max(1, round(10% of the figure)). */
export const aboutTolerance = (value: number): number => Math.max(1, Math.round(0.1 * value));

/** Whether a count of `n` under `relation` agrees with `value`. */
export function agrees(relation: Relation, n: number, value: number): boolean {
  if (relation === 'atLeast') return n <= value;
  if (relation === 'about') return Math.abs(n - value) <= aboutTolerance(value);
  return n === value;
}

/** The measure a figure id names: the part before the first dot. */
export const measureOf = (id: string): string => id.slice(0, id.indexOf('.'));

// --- the checker ----------------------------------------------------------------------------

/** Every figure's value, with counted figures taken from `counted` and derived ones summed. */
export function resolveFigures(
  counted: Readonly<Partial<Record<CountedSource, number>>>,
  figures: readonly Figure[] = FIGURES,
  derived: readonly DerivedFigure[] = DERIVED,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const f of figures) {
    const v = f.counted !== undefined ? counted[f.counted] : f.value;
    if (v === undefined) throw new Error(`figure ${f.id}: no count given for ${f.counted}`);
    values.set(f.id, v);
  }
  for (const d of derived) {
    let sum = 0;
    for (const id of d.sumOf) {
      const v = values.get(id);
      if (v === undefined) throw new Error(`derived figure ${d.id}: unknown figure ${id}`);
      sum += v;
    }
    values.set(d.id, sum);
  }
  return values;
}

export type FigureIssueKind =
  | 'unregistered'
  | 'mismatch'
  | 'wrong-measure'
  | 'unknown-figure'
  | 'no-file'
  | 'missing-phrase'
  | 'duplicate-phrase'
  | 'phrase-count'
  | 'double-entry'
  | 'no-claim';

export interface FigureIssue {
  kind: FigureIssueKind;
  message: string;
}

export interface FigureCheck {
  /** Scanned file path -> raw text. Paths match `Claim.file` and `Ignored.file`. */
  files: ReadonlyMap<string, string>;
  /** Figure id -> value, from resolveFigures. */
  values: ReadonlyMap<string, number>;
  claims?: readonly Claim[];
  ignored?: readonly Ignored[];
  rendered?: readonly Rendered[];
}

const describe = (relation: Relation, n: number): string =>
  relation === 'atLeast' ? `at least ${n}` : relation === 'about' ? `about ${n}` : `exactly ${n}`;

/**
 * Every way the copy and the table disagree: a count that is neither claimed nor ignored, a
 * claim that disagrees with its figure or names the wrong measure, a phrase that is missing,
 * repeated or does not hold exactly one count, and a figure nothing states.
 */
export function figureIssues({ files, values, claims = CLAIMS, ignored = IGNORED, rendered = RENDERED }: FigureCheck): FigureIssue[] {
  const issues: FigureIssue[] = [];
  const add = (kind: FigureIssueKind, message: string) => issues.push({ kind, message });
  const texts = new Map([...files].map(([file, raw]) => [file, normaliseWhitespace(raw)]));
  const counts = new Map([...texts].map(([file, s]) => [file, parseCounts(s)]));
  const covered = new Map<string, Set<number>>([...files.keys()].map((f) => [f, new Set<number>()]));

  /** The one count inside `phrase` in `file`, or undefined after recording why there is not one. */
  const locate = (entry: { file: string; phrase: string }, what: string): CountMatch | undefined => {
    const s = texts.get(entry.file);
    const at = `${what} "${entry.phrase}" in ${entry.file}`;
    if (s === undefined) return void add('no-file', `${at}: the file is not scanned or does not exist`);
    const phrase = normaliseWhitespace(entry.phrase);
    const start = s.indexOf(phrase);
    if (start < 0) return void add('missing-phrase', `${at}: the phrase is not in the file`);
    if (s.indexOf(phrase, start + 1) >= 0) return void add('duplicate-phrase', `${at}: the phrase occurs more than once; lengthen it`);
    const inside = counts.get(entry.file)!.filter((m) => m.index >= start && m.index + m.text.length <= start + phrase.length);
    if (inside.length !== 1) return void add('phrase-count', `${at}: holds ${inside.length} counts, need exactly 1`);
    const m = inside[0]!;
    const seen = covered.get(entry.file)!;
    if (seen.has(m.index)) return void add('double-entry', `${at}: "${m.text}" is already claimed or ignored`);
    seen.add(m.index);
    return m;
  };

  const claimed = new Set<string>();
  for (const c of claims) {
    const value = values.get(c.figure);
    if (value === undefined) {
      add('unknown-figure', `claim "${c.phrase}" in ${c.file}: no figure ${c.figure}`);
      continue;
    }
    claimed.add(c.figure);
    const m = locate(c, 'claim');
    if (!m) continue;
    if (m.measure !== measureOf(c.figure)) {
      add('wrong-measure', `claim "${c.phrase}" in ${c.file}: counts ${m.measure}, but ${c.figure} counts ${measureOf(c.figure)}`);
    } else if (!agrees(m.relation, m.n, value)) {
      add('mismatch', `claim "${c.phrase}" in ${c.file}: says ${describe(m.relation, m.n)}, but ${c.figure} is ${value}`);
    }
  }
  for (const i of ignored) locate(i, 'ignored');

  for (const [file, found] of counts) {
    for (const m of found) {
      if (!covered.get(file)!.has(m.index)) {
        add('unregistered', `${file}: "${m.text}" is a count with no claim and no ignored entry; register it in src/lib/figures.ts`);
      }
    }
  }

  for (const r of rendered) claimed.add(r.figure);
  for (const id of values.keys()) {
    if (!claimed.has(id)) add('no-claim', `figure ${id}: no claim states it`);
  }
  return issues;
}
