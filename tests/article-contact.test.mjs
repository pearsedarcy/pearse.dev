// Asserts every published article closes with one contact block (#264): a labelled
// <section data-article-contact> after the optional series nav and before the post-nav, with
// one mailto ("Re: <title>", built by aboutArticleHref) and one /rss.xml link. Assertions run
// on the sliced block only: the layout and footer carry their own mailto and links. The
// block is template markup, so the feed and social.json must not carry it. Relies on
// `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/lib/site.ts';
import { MAX_HREF } from '../src/lib/mailto.ts';
import { posts } from './lib/posts.mjs';
import { decodeEntities } from './lib/sanitise.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const published = posts().filter((p) => p.published);
const page = (id) => readFileSync(`dist/writing/${id}/index.html`, 'utf8');
const hrefs = (html) => [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
const sectionTags = (html) => [...html.matchAll(/<section\b[^>]*\bdata-article-contact\b[^>]*>/g)];
const COPY = ['Get in touch', 'Questions or a similar problem?', 'Email me about this article', 'Follow via RSS'];

/** The block, from its opening tag to the post-nav. */
function block(id) {
  const html = page(id);
  const start = html.search(/<section\b[^>]*data-article-contact\b/);
  const end = html.indexOf('<nav class="post-nav');
  assert.ok(start > 0 && end > start, `${id}: block before the post-nav`);
  return html.slice(start, end);
}

test('there are published articles to check', () => {
  assert.ok(published.length >= 3);
});

test('every article has exactly one labelled contact section, outside the post body', () => {
  for (const p of published) {
    const html = page(p.id);
    const tags = sectionTags(html);
    assert.equal(tags.length, 1, `${p.id}: one <section data-article-contact>`);
    assert.match(tags[0][0], /\baria-labelledby="article-contact-title"/, `${p.id}: labelled by article-contact-title`);
    assert.doesNotMatch(tags[0][0], /\baria-label=/, `${p.id}: no aria-label`);
    assert.equal(html.match(/\bid="article-contact-title"/g)?.length, 1, `${p.id}: one article-contact-title`);
    const heading = block(p.id).match(/<h2\b[^>]*\bid="article-contact-title"/);
    assert.ok(heading, `${p.id}: the label is an h2`);
    assert.ok(!/<nav\b[^>]*data-article-contact/.test(html), `${p.id}: not a <nav>`);
    const body = html.slice(html.indexOf('class="prose'), html.search(/<section\b[^>]*data-article-contact\b/));
    assert.ok(body.length > 0, `${p.id}: the block follows the prose body`);
  }
});

test('the block has one mailto, "Re: <title>" to SITE.email with only a subject', () => {
  for (const p of published) {
    const links = hrefs(block(p.id));
    const mails = links.filter((h) => h.startsWith('mailto:'));
    assert.equal(mails.length, 1, `${p.id}: one mailto`);
    const url = new URL(mails[0]);
    assert.equal(url.pathname, SITE.email, `${p.id}: address`);
    assert.deepEqual([...url.searchParams.keys()], ['subject'], `${p.id}: only a subject`);
    assert.equal(url.searchParams.get('subject'), `Re: ${p.data.title}`, `${p.id}: subject`);
  }
});

test('the block has one /rss.xml link', () => {
  for (const p of published) {
    assert.equal(hrefs(block(p.id)).filter((h) => h === '/rss.xml').length, 1, `${p.id}: one /rss.xml link`);
  }
});

test('the block comes after the series nav (when present) and before the post-nav', () => {
  for (const p of published) {
    const html = page(p.id);
    const at = html.search(/<section\b[^>]*data-article-contact\b/);
    assert.ok(at > 0 && at < html.indexOf('<nav class="post-nav'), `${p.id}: before the post-nav`);
    const series = html.indexOf('data-series-nav');
    if (series !== -1) assert.ok(series < at, `${p.id}: after the series nav`);
  }
});

test('the built href is within MAX_HREF for every article, and the subject is never truncated', () => {
  for (const p of published) {
    const mail = hrefs(block(p.id)).find((h) => h.startsWith('mailto:'));
    assert.ok(mail.length <= MAX_HREF, `${p.id}: href is ${mail.length} characters, over MAX_HREF ${MAX_HREF}: shorten the title`);
    assert.equal(new URL(mail).searchParams.get('subject'), `Re: ${p.data.title}`, `${p.id}: full subject`);
  }
});

test('the feed and social.json carry none of the block', () => {
  for (const f of ['dist/rss.xml', 'dist/social.json']) {
    const body = readFileSync(f, 'utf8');
    assert.ok(!body.includes('data-article-contact'), `${f}: no data-article-contact`);
    assert.ok(!body.includes('mailto:'), `${f}: no mailto:`);
    for (const copy of COPY) assert.ok(!body.includes(copy), `${f}: no "${copy}"`);
  }
});
