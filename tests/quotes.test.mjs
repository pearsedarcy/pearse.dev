// Client quotes (#279): the fail-closed `quote` field on a client case study. The pure module
// (src/lib/quotes.ts) is loaded directly through Node type stripping. Fixtures are placeholders
// only: never a real client's words, name, domain or owner. The source-level checks read the
// committed frontmatter; the dist/ checks live in tests/visibility.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ANONYMISED_ATTRIBUTION,
  FEATURED_QUOTES_MAX,
  QUOTE_ATTRIBUTION_MAX,
  QUOTE_PERMISSIONS,
  QUOTE_TEXT_MAX,
  caseStudyQuote,
  featuredQuotes,
  validateQuote,
} from '../src/lib/quotes.ts';
import { compareWork } from '../src/lib/work-order.ts';
import { projects } from './lib/projects.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const TEXT = 'QUOTE-FIXTURE-TEXT';
const ATTRIBUTION = 'Owner, example.com';

const quote = (over = {}) => ({ text: TEXT, attribution: ATTRIBUTION, permission: 'granted', ...over });
const client = (over = {}) => ({ category: 'client', clientPermission: 'granted', ...over });
const paths = (q, p = client()) => validateQuote(q, p).map((i) => i.path);
const rejects = (q, p, path, what) =>
  assert.ok(paths(q, p).includes(path), `${what}: expected an issue at ${path}, got ${JSON.stringify(paths(q, p))}`);
const accepts = (q, p, what) => assert.deepEqual(validateQuote(q, p), [], what);

// --- validateQuote ------------------------------------------------------------------------

test('the permission values are pending and granted only: there is no declined', () => {
  assert.deepEqual([...QUOTE_PERMISSIONS], ['pending', 'granted']);
});

test('accepts a well-formed quote, at the length caps', () => {
  accepts(quote(), client(), 'fixture');
  accepts(quote({ text: 'x'.repeat(QUOTE_TEXT_MAX) }), client(), `${QUOTE_TEXT_MAX} characters`);
  const at60 = `Owner, ${'d'.repeat(QUOTE_ATTRIBUTION_MAX - 'Owner, '.length)}`;
  assert.equal(at60.length, QUOTE_ATTRIBUTION_MAX);
  accepts(quote({ attribution: at60 }), client(), '60-character attribution');
  accepts(quote({ attribution: ANONYMISED_ATTRIBUTION }), client({ clientPermission: 'anonymised' }), 'anonymised');
});

test('rejects empty text and text over 240 characters', () => {
  rejects(quote({ text: '' }), client(), 'quote.text', '0 characters');
  rejects(quote({ text: '   ' }), client(), 'quote.text', 'whitespace only');
  rejects(quote({ text: 'x'.repeat(QUOTE_TEXT_MAX + 1) }), client(), 'quote.text', '241 characters');
  assert.equal(QUOTE_TEXT_MAX + 1, 241);
});

test('rejects a line break in the text: one paragraph only', () => {
  rejects(quote({ text: `${TEXT}\n${TEXT}` }), client(), 'quote.text', 'newline');
  rejects(quote({ text: `${TEXT}\r\n${TEXT}` }), client(), 'quote.text', 'CRLF');
  rejects(quote({ text: `${TEXT}\u2028${TEXT}` }), client(), 'quote.text', 'line separator');
});

test('rejects a verify marker in the text or the attribution', () => {
  rejects(quote({ text: `${TEXT} [VERIFY: x]` }), client(), 'quote.text', 'marker in text');
  rejects(quote({ attribution: 'Owner, [VERIFY: x]' }), client(), 'quote.attribution', 'marker in attribution');
});

test('rejects an attribution that is not "<Role>, <rest>" or is over 60 characters', () => {
  rejects(quote({ attribution: 'Owner' }), client(), 'quote.attribution', 'no comma');
  rejects(quote({ attribution: 'Owner example.com' }), client(), 'quote.attribution', 'no comma, spaced');
  rejects(quote({ attribution: 'Owner, example, com' }), client(), 'quote.attribution', 'two commas');
  rejects(quote({ attribution: ', example.com' }), client(), 'quote.attribution', 'empty role');
  rejects(quote({ attribution: 'Owner, ' }), client(), 'quote.attribution', 'empty rest');
  rejects(quote({ attribution: '' }), client(), 'quote.attribution', 'empty');
  rejects(quote({ attribution: 'Owner,\nexample.com' }), client(), 'quote.attribution', 'line break');
  const over = `Owner, ${'d'.repeat(QUOTE_ATTRIBUTION_MAX)}`;
  rejects(quote({ attribution: over }), client(), 'quote.attribution', `${over.length} characters`);
});

test('on an anonymised case study, only the exact anonymised attribution passes', () => {
  const anon = client({ clientPermission: 'anonymised' });
  rejects(quote(), anon, 'quote.attribution', 'role and domain');
  rejects(quote({ attribution: 'Client, Website project' }), anon, 'quote.attribution', 'different case');
  rejects(quote({ attribution: 'Client, website project ' }), anon, 'quote.attribution', 'trailing space');
  rejects(quote({ attribution: 'Owner, website project' }), anon, 'quote.attribution', 'different role');
  accepts(quote({ attribution: ANONYMISED_ATTRIBUTION }), anon, 'exact');
});

test('a quote on any non-client case study fails: the schema refinement runs validateQuote', () => {
  for (const category of ['mts', 'tool', 'learning']) {
    rejects(quote(), { category }, 'quote', category);
  }
  const config = readFileSync('src/content.config.ts', 'utf8');
  assert.match(config, /validateQuote\(d\.quote, d\)/, 'the projects schema calls validateQuote on every quote');
  assert.match(config, /quote:\s*z\s*\.object\(\{[\s\S]*?\}\)\s*\.strict\(\)/, 'the quote mapping is strict: no extra keys');
});

test('validation runs whatever the permission: a pending quote with a bad attribution is still rejected', () => {
  rejects(quote({ permission: 'pending', attribution: 'Owner' }), client(), 'quote.attribution', 'pending');
  rejects(quote({ permission: undefined, attribution: 'Owner' }), client(), 'quote.attribution', 'permission absent');
  rejects(quote({ permission: 'pending', text: '' }), client(), 'quote.text', 'pending, empty text');
});

test('messages never echo the quote text or attribution', () => {
  const bad = { text: `${TEXT}\n[VERIFY: x]${'y'.repeat(QUOTE_TEXT_MAX)}`, attribution: 'Owner example, a, b', permission: 'pending' };
  for (const { message } of validateQuote(bad, client({ clientPermission: 'anonymised' }))) {
    assert.equal(message.includes(TEXT), false, message);
    assert.equal(message.includes('Owner example'), false, message);
  }
});

// --- selection ----------------------------------------------------------------------------

test('caseStudyQuote: nothing unless the quote is granted and the case study is visible', () => {
  assert.equal(caseStudyQuote(client()), undefined, 'no quote');
  assert.equal(caseStudyQuote(client({ quote: quote({ permission: 'pending' }) })), undefined, 'pending quote');
  assert.equal(caseStudyQuote(client({ quote: quote({ permission: undefined }) })), undefined, 'permission absent');
  assert.equal(caseStudyQuote(client({ clientPermission: 'pending', quote: quote() })), undefined, 'granted quote, pending case study');
  assert.equal(caseStudyQuote({ category: 'client', quote: quote() }), undefined, 'granted quote, clientPermission absent');
  assert.equal(caseStudyQuote(client({ smallerBuild: true, quote: quote() })), undefined, 'smaller build: no page to show it on');
  assert.equal(caseStudyQuote({ category: 'tool', quote: quote() }), undefined, 'non-client');
  assert.equal(caseStudyQuote(client({ quote: quote({ attribution: 'Owner' }) })), undefined, 'invalid quote');
});

test('caseStudyQuote: the quote for a granted quote on a granted or anonymised case study', () => {
  const q = quote();
  assert.equal(caseStudyQuote(client({ quote: q })), q, 'granted case study');
  const a = quote({ attribution: ANONYMISED_ATTRIBUTION });
  assert.equal(caseStudyQuote(client({ clientPermission: 'anonymised', quote: a })), a, 'anonymised case study');
});

const entry = (slug, order, over = {}) => client({ slug, order, title: slug, ...over });

test('featuredQuotes: at most two, renderable only', () => {
  const list = [
    entry('a', 1, { quote: quote() }),
    entry('b', 2, { quote: quote({ permission: 'pending' }) }),
    entry('c', 3, { clientPermission: 'pending', quote: quote() }),
    entry('d', 4, { quote: quote() }),
    entry('e', 5, { quote: quote() }),
    entry('f', 6),
  ];
  assert.equal(FEATURED_QUOTES_MAX, 2);
  assert.deepEqual(featuredQuotes(list).map((x) => x.project.slug), ['a', 'd']);
  assert.deepEqual(featuredQuotes(list, 5).map((x) => x.project.slug), ['a', 'd', 'e']);
  assert.deepEqual(featuredQuotes(list, 0), []);
  assert.deepEqual(featuredQuotes([]), []);
  assert.deepEqual(featuredQuotes(list.filter((p) => !p.quote || p.quote.permission !== 'granted')), [], 'no renderable quotes');
});

test('featuredQuotes: compareWork order, not featured-first and not input or `order`-only order', () => {
  // Featured-first (the home grid) would put `late` first; compareWork puts `early` first.
  const featured = [entry('late', 9, { featured: true, quote: quote() }), entry('early', 3, { quote: quote() })];
  assert.deepEqual(featuredQuotes(featured).map((x) => x.project.slug), ['early', 'late']);
  // Equal `order`: a stable sort on `order` alone (getVisibleProjects) keeps the input order, z
  // then a; compareWork breaks the tie by slug.
  const tied = [entry('z', 4, { quote: quote() }), entry('a', 4, { quote: quote() })];
  const byOrder = [...tied].sort((x, y) => x.order - y.order).map((p) => p.slug);
  const byWork = [...tied].sort(compareWork).map((p) => p.slug);
  assert.notDeepEqual(byOrder, byWork, 'the fixture must separate the two orders');
  assert.deepEqual(featuredQuotes(tied).map((x) => x.project.slug), byWork);
  // The cap applies after sorting: the first two in work order, whatever the input order.
  const three = [entry('c', 7, { quote: quote() }), entry('b', 5, { quote: quote() }), entry('a', 6, { quote: quote() })];
  assert.deepEqual(featuredQuotes(three).map((x) => x.project.slug), ['b', 'a']);
});

// --- committed content --------------------------------------------------------------------

test('every committed quote has permission: granted (no pending or declined entry is ever committed)', () => {
  for (const p of projects().filter((x) => x.quote !== undefined)) {
    assert.equal(p.quote?.permission, 'granted', `${p.file}: a quote is committed only once permission is granted`);
  }
});

test('every committed quote is on a client case study and passes validateQuote', () => {
  for (const p of projects().filter((x) => x.quote !== undefined)) {
    assert.equal(p.category, 'client', p.file);
    assert.deepEqual(validateQuote(p.quote, p).map((i) => i.message), [], p.file);
  }
});
