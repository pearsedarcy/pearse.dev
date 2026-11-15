// Asserts the client-permission rule: the pure function on every flag value, client case
// studies with clientPermission: granted present everywhere in the build, and pending ones
// (none today; the list is derived from the source files) absent from it.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseStudyRepos, isCaseStudy, isVisibleProject } from '../src/lib/visibility.ts';
import { featuredQuotes } from '../src/lib/quotes.ts';
import { pendingSlugs, projects } from './lib/projects.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const HIDDEN = pendingSlugs();
// Client case studies whose permission was granted on 2026-10-28 (#40). Hard-coded on purpose.
const GRANTED = ['east-coast-blinds', 'dublin-plein-air', 'm-buildz', 'pauldarcy-ie'];

test('isVisibleProject: only a client case study without permission is hidden', () => {
  assert.equal(isVisibleProject({ category: 'client', clientPermission: 'granted' }), true);
  assert.equal(isVisibleProject({ category: 'client', clientPermission: 'anonymised' }), true);
  assert.equal(isVisibleProject({ category: 'client', clientPermission: 'pending' }), false);
  assert.equal(isVisibleProject({ category: 'client' }), false, 'absent flag defaults to pending');
  for (const category of ['mts', 'tool', 'learning']) {
    assert.equal(isVisibleProject({ category, clientPermission: 'pending' }), true, category);
    assert.equal(isVisibleProject({ category }), true, category);
  }
});

test('isCaseStudy: visible and not a smaller build (ADR 0007)', () => {
  assert.equal(isCaseStudy({ category: 'client', clientPermission: 'pending' }), false, 'pending client');
  assert.equal(isCaseStudy({ category: 'client' }), false, 'client with no flag is pending');
  assert.equal(isCaseStudy({ category: 'client', clientPermission: 'pending', smallerBuild: true }), false);
  assert.equal(isCaseStudy({ category: 'tool', smallerBuild: true }), false, 'visible smaller build');
  assert.equal(isCaseStudy({ category: 'client', clientPermission: 'granted', smallerBuild: true }), false);
  for (const category of ['mts', 'tool', 'learning']) {
    assert.equal(isCaseStudy({ category }), true, `${category}, flag absent`);
    assert.equal(isCaseStudy({ category, smallerBuild: false }), true, `${category}, flag false`);
  }
  assert.equal(isCaseStudy({ category: 'client', clientPermission: 'granted', smallerBuild: false }), true);
});

test('caseStudyRepos: only case studies with a page and a repo link a repo card (#275)', () => {
  const gh = (n) => `https://github.com/pearsedarcy/${n}`;
  const fixtures = [
    { slug: 'small', title: 'Small', category: 'learning', smallerBuild: true, repo: gh('small') },
    { slug: 'pending', title: 'Pending', category: 'client', clientPermission: 'pending', repo: gh('pending') },
    { slug: 'unflagged', title: 'Unflagged', category: 'client', repo: gh('unflagged') },
    { slug: 'granted', title: 'Granted', category: 'client', clientPermission: 'granted', repo: gh('granted') },
    { slug: 'tool', title: 'Tool', category: 'tool', repo: gh('tool') },
    { slug: 'no-repo', title: 'No repo', category: 'tool' },
  ];
  assert.deepEqual(caseStudyRepos(fixtures), [
    { repo: gh('granted'), slug: 'granted', title: 'Granted' },
    { repo: gh('tool'), slug: 'tool', title: 'Tool' },
  ]);
  assert.deepEqual(caseStudyRepos([]), []);
});

test('every client case study states its permission explicitly', () => {
  for (const p of projects().filter((x) => x.category === 'client')) {
    assert.ok(['pending', 'granted', 'anonymised'].includes(p.clientPermission), `${p.file}: clientPermission`);
  }
});

test('the granted client case studies are granted in source', () => {
  const bySlug = new Map(projects().map((p) => [p.slug, p]));
  for (const slug of GRANTED) {
    assert.equal(bySlug.get(slug)?.category, 'client', slug);
    assert.equal(bySlug.get(slug)?.clientPermission, 'granted', slug);
  }
});

test('granted client case studies have a page, a sitemap entry and a card under Client work on /work/', () => {
  const sitemap = readFileSync('dist/sitemap-0.xml', 'utf8');
  const index = readFileSync('dist/work/index.html', 'utf8');
  // The /work/ index renders one <section> per category, headed by an h2 with id group-<category>.
  const client = index.split(/<section\b/).find((sec) => sec.includes('id="group-client"')) ?? '';
  assert.ok(client, 'no Client work section on /work/');
  for (const slug of GRANTED) {
    assert.equal(existsSync(`dist/work/${slug}/index.html`), true, slug);
    assert.ok(sitemap.includes(`/work/${slug}/`), `${slug} in sitemap`);
    assert.ok(client.includes(`href="/work/${slug}/"`), `${slug} under Client work`);
  }
});

function htmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) htmlFiles(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

test('no page directory for pending client case studies', () => {
  for (const slug of HIDDEN) assert.equal(existsSync(`dist/work/${slug}`), false, slug);
});

test('no href to pending case studies in any html', () => {
  for (const file of htmlFiles('dist')) {
    const html = readFileSync(file, 'utf8');
    for (const slug of HIDDEN) assert.equal(html.includes(`/work/${slug}`), false, `${file} links ${slug}`);
  }
});

test('pending case studies are absent from the sitemap', () => {
  const sitemap = readFileSync('dist/sitemap-0.xml', 'utf8');
  for (const slug of HIDDEN) assert.equal(sitemap.includes(slug), false, slug);
});

// Expected home grid, in /work/ order (#295): the six picked are the featured case studies, then the first
// non-featured ones by `order`; they show sorted by their /work/ number. Smaller builds are never cards (#169). Hard-coded on purpose;
// update it when content changes.
const HOME_SLUGS = ['mts-hub', 'wetlabs-app', 'east-coast-blinds', 'dublin-plein-air', 'm-buildz', 'agentic-workflow'];

test('home grid shows exactly the expected six cards, in order', () => {
  // Selector: anchors with class "card" linking to /work/<slug>/ inside <section id="work">.
  const html = readFileSync('dist/index.html', 'utf8');
  const section = html.match(/<section id="work"[\s\S]*?<\/section>/)?.[0] ?? '';
  const cards = (section.match(/<a [^>]*href="\/work\/[a-z0-9-]+\/"[^>]*>/g) ?? []).filter((a) => /class="[^"]*\bcard\b/.test(a));
  assert.deepEqual(cards.map((a) => a.match(/href="\/work\/([a-z0-9-]+)\//)[1]), HOME_SLUGS);
});

test('/work/ index links only case studies and its count matches', () => {
  const caseStudies = projects().filter((p) => p.caseStudy).length;
  const html = readFileSync('dist/work/index.html', 'utf8');
  const hrefs = new Set(html.match(/href="\/work\/[a-z0-9-]+\/"/g) ?? []);
  assert.equal(hrefs.size, caseStudies);
  const count = html.match(/<b>(\d+)<\/b>\s+projects/)?.[1];
  assert.equal(Number(count), caseStudies);
  assert.equal(count, String(caseStudies).padStart(2, '0'), 'two-digit header count');
});

test('home "All N projects" equals the /work/ header count (#169)', () => {
  const home = readFileSync('dist/index.html', 'utf8').match(/All (\d+) projects/)?.[1];
  const work = readFileSync('dist/work/index.html', 'utf8').match(/<b>(\d+)<\/b>\s+projects/)?.[1];
  assert.ok(home && work, 'both counts present');
  assert.equal(Number(home), Number(work));
  assert.equal(Number(home), projects().filter((p) => p.caseStudy).length);
});

// --- client quotes (#279) -----------------------------------------------------------------
// The fail-closed rule lives in src/lib/quotes.ts; tests/lib/projects.mjs derives each project's
// rendered quote from source with it. Today no quote is committed, so every count here is 0.

const countQuotes = (html) => (html.match(/\sdata-client-quote(?=[\s>=])/g) ?? []).length;

test('data-client-quote elements in dist/ match the renderable quotes derived from source', () => {
  const all = projects();
  const rendered = all.filter((p) => p.renderedQuote);
  const featured = featuredQuotes(all).length;
  let onCasePages = 0;
  for (const file of htmlFiles('dist')) {
    const n = countQuotes(readFileSync(file, 'utf8'));
    const slug = file.match(/^dist[\\/]work[\\/]([a-z0-9-]+)[\\/]index\.html$/)?.[1];
    if (slug) {
      const expected = all.find((p) => p.slug === slug)?.renderedQuote ? 1 : 0;
      assert.equal(n, expected, `${file}: ${n} quotes, expected ${expected}`);
      onCasePages += n;
    } else if (file === join('dist', 'index.html') || file === join('dist', 'cv', 'index.html')) {
      assert.equal(n, featured, `${file}: ${n} quotes, expected the ${featured} featured ones`);
    } else {
      assert.equal(n, 0, `${file} renders a client quote`);
    }
  }
  assert.equal(onCasePages, rendered.length, 'one data-client-quote per renderable quote across the case study pages');
});

test('no quote text that does not render appears on any page, hidden case studies included', () => {
  // A hidden case study's quote never renders (caseStudyQuote), so it is always in this list.
  const unrendered = projects().filter((p) => p.quote && !p.renderedQuote);
  assert.equal(projects().some((p) => !p.visible && p.renderedQuote), false, 'a hidden case study renders no quote');
  for (const file of htmlFiles('dist')) {
    const html = readFileSync(file, 'utf8');
    for (const p of unrendered) {
      if (typeof p.quote.text === 'string' && p.quote.text.trim()) {
        assert.equal(html.includes(p.quote.text), false, `${file} shows the unrendered quote of ${p.file}`);
      }
    }
  }
});

test('with no renderable quote, no page has a quote block or an empty quote heading', () => {
  const pages = ['dist/index.html', 'dist/cv/index.html', ...htmlFiles('dist/work').filter((f) => /index\.html$/.test(f))];
  if (featuredQuotes(projects()).length === 0) {
    for (const file of ['dist/index.html', 'dist/cv/index.html']) {
      const html = readFileSync(file, 'utf8');
      assert.equal(html.includes('id="quotes-title"'), false, `${file}: home quotes heading with no quotes`);
      assert.equal(html.includes('id="cv-quotes"'), false, `${file}: CV quotes heading with no quotes`);
      assert.equal(/class="[^"]*\bhome-quotes\b/.test(html), false, `${file}: empty home quotes block`);
    }
  }
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const slug = file.match(/work[\\/]([a-z0-9-]+)[\\/]index\.html$/)?.[1];
    const p = slug && projects().find((x) => x.slug === slug);
    if (slug && !p?.renderedQuote) assert.equal(countQuotes(html), 0, `${file}: quote block with no renderable quote`);
  }
});

test('no structured data for quotes: no Review or AggregateRating JSON-LD anywhere', () => {
  for (const file of htmlFiles('dist')) {
    const html = readFileSync(file, 'utf8');
    for (const ld of html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/g) ?? []) {
      assert.equal(/"@type"\s*:\s*"(?:Review|AggregateRating|Rating)"/.test(ld), false, `${file}: review structured data`);
    }
  }
});
