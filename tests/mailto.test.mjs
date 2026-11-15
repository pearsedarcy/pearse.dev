// Every mailto on the built site goes through src/lib/mailto.ts (#153): the address is
// SITE.email, the query carries only `subject` and/or `body`, and every subject is in the
// closed set (plus "About <title>" on that case study's own page, #103). Also checks the home
// brief form, the copy-email buttons and the /now/ order. Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/lib/site.ts';
import { MAX_BODY, SUBJECTS } from '../src/lib/mailto.ts';
import { find, hasClass, parseHtml, text } from './lib/html.mjs';
import { projects } from './lib/projects.mjs';
import { posts } from './lib/posts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const read = (f) => readFileSync(f, 'utf8');
const walk = (dir, keep) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, keep) : keep(p) ? [p] : [];
  });

/** Attribute values as a browser reads them: Astro escapes `&` as `&amp;` or `&#38;`. */
const decode = (v) =>
  v
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

const PAGES = walk('dist', (p) => p.endsWith('.html'));
const CLOSED = new Set(Object.values(SUBJECTS));
/** dist path of each visible case study -> the one extra subject its page may carry. */
const CASE_SUBJECT = new Map(projects().filter((p) => p.caseStudy).map((p) => [join('dist', 'work', p.slug, 'index.html'), `About ${p.title}`]));
/** dist path of each published article -> the one extra subject its page may carry (#264). */
const POST_SUBJECT = new Map(posts().filter((p) => p.published).map((p) => [join('dist', 'writing', p.id, 'index.html'), `Re: ${p.data.title}`]));

/** True when `subject` is in the closed set or is the one extra subject this page's own case study or article may carry. */
const subjectAllowed = (file, subject) => CLOSED.has(subject) || CASE_SUBJECT.get(file) === subject || POST_SUBJECT.get(file) === subject;

/** Every mailto href, plus every form action that is a mailto, decoded. */
function mailtos(html) {
  const hrefs = [...html.matchAll(/\shref="(mailto:[^"]+)"/g)].map((m) => decode(m[1]));
  const actions = [...html.matchAll(/<form\b[^>]*\saction="(mailto:[^"]*)"/g)].map((m) => decode(m[1]));
  return [...hrefs, ...actions];
}

test('the key pages carry mailto links', () => {
  for (const f of ['dist/index.html', 'dist/cv/index.html', 'dist/now/index.html']) {
    assert.ok(PAGES.includes(f), f);
    assert.ok(mailtos(read(f)).length > 0, `${f}: no mailto`);
  }
});

test('every mailto on every page is SITE.email with only subject/body and a closed-set subject', () => {
  let n = 0;
  for (const f of PAGES) {
    for (const raw of mailtos(read(f))) {
      n++;
      const url = new URL(raw);
      assert.equal(url.pathname, SITE.email, `${f}: ${raw}`);
      for (const key of url.searchParams.keys()) assert.ok(key === 'subject' || key === 'body', `${f}: query key ${key}`);
      assert.ok(url.searchParams.getAll('subject').length <= 1, `${f}: one subject at most`);
      const subject = url.searchParams.get('subject');
      if (subject === null) continue;
      assert.ok(subjectAllowed(f, subject), `${f}: subject "${subject}" not in the closed set`);
    }
  }
  assert.ok(n >= 3);
});

test('a subject is accepted only on its own page: the negative fixture (#264)', () => {
  const entries = [...POST_SUBJECT];
  assert.ok(entries.length >= 2, 'at least two published articles');
  const [[fileA, subjectA], [fileB, subjectB]] = entries;
  assert.equal(subjectAllowed(fileA, subjectA), true, 'own subject passes');
  assert.equal(subjectAllowed(fileA, subjectB), false, "another article's subject on this path");
  assert.equal(subjectAllowed(fileB, subjectA), false, "another article's subject, reversed");
  const [caseFile, caseSubject] = [...CASE_SUBJECT][0];
  assert.equal(subjectAllowed(caseFile, caseSubject), true, 'case subject on its own page passes');
  assert.equal(subjectAllowed(fileA, caseSubject), false, 'a case-study subject on an article path');
  assert.equal(subjectAllowed(caseFile, subjectA), false, 'an article subject on a case-study path');
});

test('the home, /cv/ and /now/ links carry their own subjects', () => {
  const subjects = (f) => mailtos(read(f)).map((h) => new URL(h).searchParams.get('subject'));
  assert.ok(subjects('dist/index.html').includes(SUBJECTS.home));
  assert.ok(subjects('dist/cv/index.html').includes(SUBJECTS.cv));
  assert.ok(subjects('dist/now/index.html').includes(SUBJECTS.now));
});

const home = () => parseHtml(read('dist/index.html'));
const byId = (root, id) => find(root, (e) => e.attrs.id === id)[0];

test('#contact has the native GET brief form to the bare address', () => {
  const contact = byId(home(), 'contact');
  assert.ok(contact, '#contact');
  const forms = find(contact, (e) => e.tag === 'form');
  assert.equal(forms.length, 1, 'one form');
  const form = forms[0];
  assert.equal(form.attrs.method, 'get');
  assert.equal(decode(form.attrs.action), `mailto:${SITE.email}`);
  assert.ok(!('enctype' in form.attrs), 'no enctype');
  assert.ok(!('hidden' in form.attrs), 'never hidden');

  const named = find(form, (e) => 'name' in e.attrs);
  assert.deepEqual(named.map((e) => e.attrs.name).sort(), ['body', 'subject', 'subject'], 'only subject (two radios) and body are named');
  assert.equal(find(form, (e) => e.tag === 'input' && e.attrs.type === 'hidden').length, 0, 'no hidden input');
  const radios = named.filter((e) => e.attrs.name === 'subject');
  assert.equal(radios.length, 2);
  for (const r of radios) {
    assert.equal(r.tag, 'input');
    assert.equal(r.attrs.type, 'radio');
  }
  assert.deepEqual(radios.map((r) => decode(r.attrs.value)), [SUBJECTS.brief, SUBJECTS.role]);
  assert.deepEqual(radios.map((r) => 'checked' in r.attrs), [true, false], 'only the project radio is checked');
  assert.deepEqual(radios.map((r) => r.attrs['data-context']), ['brief', 'role']);
  const kinds = radios.map((r) => {
    let e = r.parent;
    while (e && e.tag !== 'label') e = e.parent;
    assert.ok(e, 'radio inside a label');
    assert.ok(hasClass(e, 'brief-kind'), 'label.brief-kind');
    return text(e).trim();
  });
  assert.deepEqual(kinds, ['A project', 'A role']);
  const fieldsets = find(form, (e) => e.tag === 'fieldset');
  assert.equal(fieldsets.length, 1, 'one fieldset');
  const legend = find(fieldsets[0], (e) => e.tag === 'legend')[0];
  assert.ok(legend, 'legend');
  assert.equal(text(legend).trim(), 'What is this about?');
  assert.equal(find(fieldsets[0], (e) => e.tag === 'input').length, 2, 'the radios are inside the fieldset');

  const body = named.find((e) => e.attrs.name === 'body');
  assert.equal(body.tag, 'textarea');
  const max = Number(body.attrs.maxlength);
  assert.ok(Number.isInteger(max) && max > 0 && max <= MAX_BODY, `maxlength ${body.attrs.maxlength}`);
  assert.ok(body.attrs.id, 'textarea id');
  const labels = find(form, (e) => e.tag === 'label' && e.attrs.for === body.attrs.id);
  assert.equal(labels.length, 1, 'a <label for> matching the textarea');
  assert.equal(text(labels[0]).trim(), 'What do you need?');
});

test('the "what to include" checklist is in the server HTML', () => {
  const contact = byId(home(), 'contact');
  const includes = find(contact, (e) => 'data-brief-include' in e.attrs);
  assert.equal(includes.length, 1, 'one checklist container');
  const list = includes[0];
  assert.equal(list.attrs.id, 'brief-include');
  const body = find(contact, (e) => e.tag === 'textarea')[0];
  assert.equal(body.attrs['aria-describedby'], 'brief-include');
  const lists = find(list, (e) => e.tag === 'ul' && 'data-brief-list' in e.attrs);
  assert.equal(lists.length, 2);
  for (const ul of lists) assert.ok(!('hidden' in ul.attrs), 'no hidden attribute');
  const items = (kind) => find(lists.find((u) => u.attrs['data-brief-list'] === kind), (e) => e.tag === 'li').map((li) => text(li).trim());
  assert.deepEqual(items('brief'), ['The problem', 'The current stack', 'The timeline', 'A link, if there is one']);
  assert.deepEqual(items('role'), ['The company', 'The role', 'Remote or on-site', 'The timeline']);
  assert.equal(find(list, (e) => e.tag === 'h3').length, 1, 'one "What to include" heading, outside both lists');
});

test('the preset switch is CSS only: a scoped :has() rule and 24px tap targets', () => {
  const css = walk('dist', (p) => p.endsWith('.css'))
    .map(read)
    .join('\n');
  const inline = [...read('dist/index.html').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const all = `${css}\n${inline}`.replace(/\s+/g, '');
  assert.match(all, /:has\([^)]*:checked\)[^{]*\{[^}]*display:none/);
  const rule = all.match(/\.brief-kind(?![\w-])[^{]*\{([^}]*)\}/g)?.find((r) => r.includes('min-height'));
  assert.ok(rule, '.brief-kind rule with min-height');
  const m = rule.match(/min-height:([\d.]+)(rem|px)/);
  assert.ok(m, rule);
  assert.ok(m[2] === 'rem' ? Number(m[1]) >= 1.5 : Number(m[1]) >= 24, `min-height ${m[0]}`);
  assert.match(rule, /display:inline-flex/);
  assert.match(rule, /align-items:center/);
});

test('the brief script has no script-driven toggle', () => {
  const src = read('src/components/ContactBrief.astro');
  const script = src.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'script block');
  assert.doesNotMatch(script, /hidden/);
  assert.doesNotMatch(script, /\.style\b/);
  assert.doesNotMatch(script, /data-brief-list/);
  assert.doesNotMatch(src, /type="hidden"/, 'no hidden input left');
  assert.match(script, /dataset\.context/, 'reads the radio data-context');
  assert.doesNotMatch(script, /\.value\b[^;]*buildMailto|buildMailto\([^)]*subject/, 'the radio value never reaches the builder');
});

/** The element holding the address link also holds a copy button for that address. */
function assertCopyBeside(container, where) {
  const link = find(container, (e) => e.tag === 'a' && (e.attrs.href ?? '').startsWith('mailto:'))[0];
  assert.ok(link, `${where}: address link`);
  assert.equal(text(link).trim(), SITE.email, `${where}: the address is visible text`);
  const buttons = find(link.parent, (e) => e.tag === 'button' && 'data-copy' in e.attrs);
  assert.equal(buttons.length, 1, `${where}: one copy button beside the address`);
  const btn = buttons[0];
  assert.equal(btn.attrs['data-copy'], SITE.email, where);
  assert.equal(btn.attrs.type, 'button', where);
  assert.ok(hasClass(btn, 'btn'), `${where}: reuses .btn`);
  assert.ok(!('hidden' in btn.attrs), `${where}: space reserved with visibility, not hidden`);
  const status = find(link.parent, (e) => e.attrs['aria-live'] === 'polite');
  assert.equal(status.length, 1, `${where}: a polite status`);
  return btn;
}

test('a copy button sits beside the address on / and on /cv/, hidden in print', () => {
  assertCopyBeside(byId(home(), 'contact'), '/');
  const cv = parseHtml(read('dist/cv/index.html'));
  const list = find(cv, (e) => hasClass(e, 'cv-contact'))[0];
  assert.ok(list, '/cv/ contact list');
  const btn = assertCopyBeside(list, '/cv/');
  let screenOnly = false;
  for (let e = btn.parent; e; e = e.parent) if (hasClass(e, 'cv-screen')) screenOnly = true;
  assert.ok(screenOnly, '/cv/: the copy control is inside .cv-screen, which print hides');
});

test('the copy buttons are revealed with visibility, so no layout shift', () => {
  const css = walk('dist', (p) => p.endsWith('.css'))
    .map(read)
    .join('\n');
  const inline = [...read('dist/index.html').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const all = `${css}\n${inline}`.replace(/\s+/g, '');
  assert.match(all, /\.copy-email-btn[^{]*\{visibility:hidden\}/);
  assert.match(all, /\.brief-copy[^{]*\{visibility:hidden\}/);
});

test('/now/: the mailto closes "Open to conversations", the last section', () => {
  const html = read('dist/now/index.html');
  const heading = html.search(/<h2\b[^>]*>Open to conversations<\/h2>/);
  assert.ok(heading > 0, 'heading present');
  const first = html.search(/\shref="mailto:/);
  assert.ok(first > heading, 'the first mailto comes after the heading');
  assert.equal(html.slice(heading + 1).search(/<h2\b/), -1, '"Open to conversations" is the last h2');
  assert.equal((html.match(/\shref="mailto:/g) ?? []).length, 1, 'the address is linked once');
  assert.doesNotMatch(read('src/content/now/now.md'), /mailto:|@pearse\.dev/, 'no hand-typed address in now.md');
});

test('no mailto: in src outside the builder, apart from comments', () => {
  const files = walk('src', (p) => /\.(astro|ts|mjs|js|md|mdx)$/.test(p));
  const builder = join('src', 'lib', 'mailto.ts');
  const hits = [];
  for (const f of files) {
    if (f === builder) continue;
    read(f)
      .split('\n')
      .forEach((line, i) => {
        if (!line.includes('mailto:')) return;
        const t = line.trim();
        if (/^(\/\/|\/\*|\*|\{\/\*|<!--)/.test(t)) return;
        hits.push(`${relative(ROOT, join(ROOT, f))}:${i + 1}`);
      });
  }
  assert.deepEqual(hits, []);
});

test('Lighthouse audits /cv/ too and caps cumulative layout shift at 0.02 on every URL', () => {
  const rc = JSON.parse(read('lighthouserc.json'));
  assert.ok(rc.ci.collect.url.includes('http://localhost/cv/'));
  // The key is the bare audit id: lhci splits keys on ":" and ".", so "audits:…" would assert nothing.
  assert.deepEqual(rc.ci.assert.assertions['cumulative-layout-shift'], ['error', { maxNumericValue: 0.02 }]);
});

test('no literal address in src outside src/lib/site.ts', () => {
  const site = join('src', 'lib', 'site.ts');
  const hits = walk('src', (p) => /\.(astro|ts|mjs|js|md|mdx|json)$/.test(p) && p !== site).filter((f) => read(f).includes(SITE.email));
  assert.deepEqual(hits, []);
});
