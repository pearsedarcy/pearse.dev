// Asserts the header wraps instead of clipping Contact at 320px (five primary links since #261), and that header, footer and
// standalone links are at least 24px tall (#105, #190, WCAG 1.4.10 and 2.5.8). The pixel
// measurements were done in a browser (see the PRs); these tests pin the classes and the CSS
// rules that produce them. Relies on `npm test`'s pretest build.
//
// The standalone links of #190 (case-study Code row, home "All ..." links, CV contacts) sit in
// layouts that must not move, so each pairs its padding with an equal negative margin: the box
// grows to a full target while the line it sits in keeps its height (measured unchanged at 390
// and 1280px). The CV contacts take 2px, not 8px: their rows are 28.75px apart, so 8px would
// make neighbouring targets overlap, while 2px gives 26.4px boxes that do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEGAL } from '../src/lib/site.ts';
import { legalState } from '../src/lib/legal.ts';
import { posts } from './lib/posts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const PAGES = ['dist/index.html', 'dist/work/index.html', 'dist/cv/index.html'];
// Eight fixed footer links, plus Impressum once its block is complete (#155).
const FOOTER_LINKS = 8 + (legalState(LEGAL).state === 'complete' ? 1 : 0);
const read = (f) => readFileSync(f, 'utf8');
const anchors = (html) => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
const classOf = (tag) => tag.match(/\bclass="([^"]*)"/)?.[1] ?? '';
const section = (html, open, close) => {
  const start = html.indexOf(open);
  assert.notEqual(start, -1, `${open} present`);
  const end = html.indexOf(close, start);
  assert.notEqual(end, -1, `${close} present`);
  return html.slice(start, end);
};
const assertTarget = (tag, where) => {
  const cls = classOf(tag);
  assert.match(cls, /\binline-block\b/, `${where}: ${tag}`);
  assert.match(cls, /\bpy-2\b/, `${where}: ${tag}`);
};
/** A target whose padding `pad` is cancelled by an equal negative margin, so layout is unchanged. */
const assertNeutralTarget = (tag, where, pad) => {
  const cls = classOf(tag).split(/\s+/);
  assert.ok(cls.includes('inline-block'), `${where}: inline-block: ${tag}`);
  assert.ok(cls.includes(`py-${pad}`), `${where}: py-${pad}: ${tag}`);
  assert.ok(cls.includes(`-my-${pad}`), `${where}: -my-${pad}: ${tag}`);
};
const sections = (html, open, close) => {
  const out = [];
  for (let i = html.indexOf(open); i !== -1; i = html.indexOf(open, i + 1)) out.push(html.slice(i, html.indexOf(close, i)));
  return out;
};

test('the header row wraps so the nav drops under the logo instead of clipping', () => {
  for (const f of PAGES) {
    const header = read(f).match(/<header\b[^>]*>/)?.[0];
    assert.ok(header, `${f}: header`);
    assert.match(classOf(header), /\bflex-wrap\b/, f);
  }
});

test('primary nav links, the logo and every footer link are inline-block py-2 targets', () => {
  for (const f of PAGES) {
    const html = read(f);
    const nav = anchors(section(html, '<nav aria-label="Primary"', '</nav>'));
    assert.equal(nav.length, 5, `${f}: five primary links`);
    for (const a of nav) assertTarget(a, `${f} nav`);

    const logo = anchors(html).filter((a) => /aria-label="pearse\.dev home"/.test(a));
    assert.equal(logo.length, 1, `${f}: one logo link`);
    assertTarget(logo[0], `${f} logo`);

    // The licence link sits inside a sentence (#158): inline links in a sentence are exempt from the
    // target-size rule (WCAG 2.5.8), so it is left out here and checked for its href in licence.test.mjs.
    const footer = anchors(section(html, '<footer', '</footer>')).filter((a) => !a.includes('/blob/master/LICENSE-CONTENT"'));
    assert.equal(footer.length, FOOTER_LINKS, `${f}: ${FOOTER_LINKS} footer links`);
    for (const a of footer) assertTarget(a, `${f} footer`);
  }
});

test('the inlined CSS defines the wrap, inline-block and py-2 rules', () => {
  const html = read('dist/index.html');
  assert.ok(html.includes('.flex-wrap{flex-wrap:wrap}'));
  assert.ok(html.includes('.inline-block{display:inline-block}'));
  assert.match(html, /\.py-2\{padding-block:calc\(var\(--spacing\) \* 2\)\}/);
});

// Case studies named in #190; every built case study is checked, these must each have a link.
// cam-tests, chatterbox and tournament-brackets are smaller builds now (#169): their repo links
// live in the /work/ list and are checked below.
const CASES = ['m-buildz', 'pauldarcy-ie', 'dublin-plein-air', 'pearse-dev', 'skatedownhills'];
const FACTS = '<dl class="case-facts"';

test('every case-study header link (GitHub, Live) is a layout-neutral py-2 target', () => {
  const pages = readdirSync('dist/work', { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`dist/work/${d.name}/index.html`))
    .map((d) => d.name)
    .filter((slug) => read(`dist/work/${slug}/index.html`).includes(FACTS));
  for (const slug of CASES) assert.ok(pages.includes(slug), `${slug} is a built case study`);
  for (const slug of pages) {
    const links = anchors(section(read(`dist/work/${slug}/index.html`), FACTS, '</dl>'));
    if (CASES.includes(slug)) assert.ok(links.length >= 1, `${slug}: a GitHub or Live link`);
    for (const a of links) assertNeutralTarget(a, `${slug} case facts`, '2');
  }
});

test('every /work/ smaller-builds repo link is a layout-neutral py-2 target (#169)', () => {
  const links = anchors(section(read('dist/work/index.html'), '<section id="smaller-builds"', '</section>'));
  assert.ok(links.length >= 1, 'at least one public repo link');
  for (const a of links) assertNeutralTarget(a, 'smaller builds', '2');
});

test('the home section links (All N projects, All posts, All N repos) are layout-neutral py-2 targets', () => {
  const links = sections(read('dist/index.html'), '<header class="section-head"', '</header>').flatMap(anchors);
  assert.equal(links.length, 3, 'three section links');
  const hrefs = links.map((a) => a.match(/href="([^"]*)"/)?.[1]);
  assert.deepEqual(hrefs.slice(0, 2), ['/work/', '/writing/']);
  assert.match(hrefs[2], /^https:\/\/github\.com\//);
  for (const a of links) assertNeutralTarget(a, 'home section-head', '2');
});

// #357: the two controls #271 and #275 added measured 27px (brief radios) and 35px (repo-card "Case study") tall at
// 390px. Both now reach 44px, the touch size the header nav uses (#350). Measured at 390 and 1280px in Chrome:
// labels 44px tall, case-study links 79x44, and every repo card, meta row and the list itself the same height as
// with the old py-2 -my-2 link.
const ruleOf = (css, selector) => css.match(new RegExp(`${selector.replace(/[\\.[\]-]/g, '\\$&')}\\[data-astro-cid-[\\w-]+\\]\\{([^}]*)\\}`))?.[1];

test('the home repo cards\' case-study links are 44px tall and layout-neutral (#275, #357)', () => {
  const html = read('dist/index.html');
  const links = anchors(section(html, '<ul class="gh-repos"', '</ul>')).filter((a) => /href="\/work\//.test(a));
  assert.ok(links.length >= 1, 'at least one case-study link');
  for (const a of links) {
    const cls = classOf(a).split(/\s+/);
    for (const c of ['gh-case', 'inline-flex', 'items-center', 'min-h-11']) assert.ok(cls.includes(c), `${c}: ${a}`);
    assert.ok(!cls.some((c) => /^-?my-/.test(c) || /^py-/.test(c)), `no utility padding or margin fights the scoped margin: ${a}`);
  }
  assert.match(html, /\.min-h-11\{min-height:calc\(var\(--spacing\) \* 11\)\}/, 'min-h-11 = 2.75rem rule');
  assert.ok(html.includes('.inline-flex{display:inline-flex}'), 'inline-flex rule');
  assert.ok(html.includes('.items-center{align-items:center}'), 'items-center rule');
  // The negative margin is half of (1lh - 2.75rem), so the margin box is exactly one line, as py-2 -my-2 left it.
  const rule = ruleOf(html, '.gh-case');
  assert.ok(rule, '.gh-case rule');
  assert.match(rule, /margin-block:calc\((?:\.5lh - 1\.375rem|\(1lh - 2\.75rem\) \/ 2)\)/, rule);
});

test('the contact brief\'s "A project" and "A role" labels are at least 44px tall (#271, #357)', () => {
  const html = read('dist/index.html');
  const labels = html.match(/<label class="brief-kind"[^>]*>/g) ?? [];
  assert.equal(labels.length, 2, 'two brief-kind labels');
  const rule = ruleOf(html, '.brief-kind');
  assert.ok(rule, '.brief-kind rule');
  const m = rule.match(/min-height:([\d.]+)(rem|px)/);
  assert.ok(m, rule);
  assert.ok(m[2] === 'rem' ? Number(m[1]) >= 2.75 : Number(m[1]) >= 44, `min-height ${m[0]}`);
  assert.match(rule, /display:inline-flex/);
  assert.match(rule, /align-items:center/);
});

test('the CV contact links are layout-neutral py-0.5 targets', () => {
  const links = anchors(section(read('dist/cv/index.html'), '<ul class="cv-contact"', '</ul>'));
  assert.ok(links.length >= 4, `${links.length} contact links`);
  for (const a of links) assertNeutralTarget(a, 'cv contact', '0.5');
});

test('the inlined CSS defines the negative-margin rules that keep those links layout-neutral', () => {
  for (const f of ['dist/index.html', 'dist/work/m-buildz/index.html']) {
    assert.match(read(f), /\.-my-2\{margin-block:calc\(var\(--spacing\) \* -2\)\}/, f);
  }
  const cv = read('dist/cv/index.html');
  assert.ok(cv.includes('.py-0\\.5{padding-block:calc(var(--spacing) * .5)}'), 'cv py-0.5');
  assert.ok(cv.includes('.-my-0\\.5{margin-block:calc(var(--spacing) * -.5)}'), 'cv -my-0.5');
});

test('the RSS link in the /writing/ label is a layout-neutral py-2 target (#198)', () => {
  const label = section(read('dist/writing/index.html'), '<p class="label"', '</p>');
  const links = anchors(label);
  assert.equal(links.length, 1, 'one link in the label');
  assert.equal(links[0].match(/href="([^"]*)"/)?.[1], '/rss.xml');
  assertNeutralTarget(links[0], 'writing label RSS', '2');
});

test('the "Follow via RSS" link closing every published article is a layout-neutral py-2 target (#264)', () => {
  const published = posts().filter((p) => p.published);
  assert.ok(published.length > 0);
  for (const p of published) {
    const html = read(`dist/writing/${p.id}/index.html`);
    const block = section(html, '<section class="article-contact', '</section>');
    const links = anchors(block).filter((a) => a.match(/href="([^"]*)"/)?.[1] === '/rss.xml');
    assert.equal(links.length, 1, `${p.id}: one /rss.xml link in the block`);
    assertNeutralTarget(links[0], `${p.id} article RSS`, '2');
  }
});

// #205: the three groups #190 and #198 missed. Same layout-neutral idea, sized to each context.
test('the home timeline "Skatedownhills" link is a layout-neutral py-1 target (#205)', () => {
  const html = read('dist/index.html');
  const rows = sections(html, '<ol class="timeline"', '</ol>');
  assert.equal(rows.length, 1, 'one timeline');
  const links = anchors(rows[0]);
  assert.equal(links.length, 1, 'one link in the timeline');
  assert.equal(links[0].match(/href="([^"]*)"/)?.[1], '/work/skatedownhills/');
  assertNeutralTarget(links[0], 'timeline', '1');
  assert.match(html, /\.py-1\{padding-block:var\(--spacing\)\}/, 'py-1 rule');
  assert.match(html, /\.-my-1\{margin-block:calc\(var\(--spacing\) \* -1\)\}/, '-my-1 rule');
});

test('the /cv/ project links are layout-neutral py-0.5 targets (#205)', () => {
  const html = read('dist/cv/index.html');
  const links = anchors(section(html, '<ul class="cv-work"', '</ul>'));
  const texts = [...section(html, '<ul class="cv-work"', '</ul>').matchAll(/<a\b[^>]*>\s*([^<]*?)\s*<\/a>/g)].map((m) => m[1]);
  for (const name of ['MTS Hub', 'wetlabs.app', 'East Coast Blinds', 'Dublin Plein Air']) {
    assert.ok(texts.includes(name), `${name} is a project link`);
  }
  assert.ok(links.length >= 4, `${links.length} project links`);
  for (const a of links) assertNeutralTarget(a, 'cv projects', '0.5');
});

test('the footer CV link is padded to 24px wide with a matching negative margin (#205)', () => {
  for (const f of PAGES) {
    const html = read(f);
    const cv = anchors(section(html, '<footer', '</footer>')).filter((a) => /href="\/cv\/"/.test(a));
    assert.equal(cv.length, 1, `${f}: one footer CV link`);
    const cls = classOf(cv[0]).split(/\s+/);
    for (const c of ['inline-block', 'px-1', '-mx-1', 'py-2']) assert.ok(cls.includes(c), `${f}: ${c}: ${cv[0]}`);
  }
  const html = read('dist/index.html');
  assert.match(html, /\.px-1\{padding-inline:var\(--spacing\)\}/, 'px-1 rule');
  assert.match(html, /\.-mx-1\{margin-inline:calc\(var\(--spacing\) \* -1\)\}/, '-mx-1 rule');
});

// #350: "CV" is two letters, so its link was 16px wide. Every primary link takes min-w-11 (2.75rem = 44px, the touch
// guidance) with centred text; the base gap drops from 12px to 8px so the five still fit one row at 320px (measured:
// 16-294px of a 304px content box; Work, CV and About are padded to 44px, Writing and Contact are 57px).
test('every primary nav link is at least 44px wide with centred text, and the five still fit 320px (#350)', () => {
  for (const f of PAGES) {
    const html = read(f);
    const nav = anchors(section(html, '<nav aria-label="Primary"', '</nav>'));
    assert.equal(nav.length, 5, `${f}: five primary links`);
    for (const a of nav) {
      const cls = classOf(a).split(/\s+/);
      for (const c of ['min-w-11', 'text-center']) assert.ok(cls.includes(c), `${f}: ${c}: ${a}`);
    }
    const ul = section(html, '<nav aria-label="Primary"', '</ul>').match(/<ul\b[^>]*>/)?.[0];
    assert.ok(ul, `${f}: nav list`);
    // 5 x 44px = 220px of targets leaves room for four gaps: 4px (#346: 8px overflowed the 16px gutter at 305px), not 12px, below sm.
    assert.ok(classOf(ul).split(/\s+/).includes('gap-1'), `${f}: base gap is gap-1: ${ul}`);
    assert.doesNotMatch(classOf(ul), /(^|\s)gap-3\b/, `${f}: no 12px base gap`);
  }
  const html = read('dist/index.html');
  assert.match(html, /--spacing:\.25rem/, '1 spacing unit is 0.25rem');
  assert.match(html, /\.min-w-11\{min-width:calc\(var\(--spacing\) \* 11\)\}/, 'min-w-11 = 2.75rem rule');
});

// #261: CV is the third of five primary links, and is current only on /cv/.
test('the primary nav is Work, Writing, CV, About, Contact, and only /cv/ marks CV current (#261)', () => {
  const nav = (f) => anchors(section(read(f), '<nav aria-label="Primary"', '</nav>'));
  const hrefs = (links) => links.map((a) => a.match(/href="([^"]*)"/)?.[1]);
  for (const f of PAGES) assert.deepEqual(hrefs(nav(f)), ['/work/', '/writing/', '/cv/', '/#about', '/#contact'], f);
  const cvLink = (f) => nav(f).find((a) => /href="\/cv\/"/.test(a));
  assert.match(cvLink('dist/cv/index.html'), /aria-current="page"/);
  assert.doesNotMatch(cvLink('dist/index.html'), /aria-current/);
  assert.doesNotMatch(cvLink('dist/work/index.html'), /aria-current/);
});
