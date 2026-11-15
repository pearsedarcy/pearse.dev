// The built skills map (#163): /stack/, the home matrix, the marquee links and the CV block.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSkillGroups, resolveWord } from '../src/lib/skill-map.ts';
import { isCaseStudy } from '../src/lib/visibility.ts';
import { MARQUEE, SKILL_MAP } from '../src/lib/site.ts';
import { find, hasClass, parseHtml, text } from './lib/html.mjs';
import { pendingSlugs, projects } from './lib/projects.mjs';
import { stripTags } from './lib/sanitise.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const STACK = 'dist/stack/index.html';
const page = (file) => parseHtml(readFileSync(file, 'utf8'));
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const evidenced = () => new Map(buildSkillGroups(SKILL_MAP, projects(), isCaseStudy).flatMap((g) => g.rows.map((r) => [r.name, r])));

/** Every built HTML file under dist/. */
function htmlFiles(dir = 'dist') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? htmlFiles(`${dir}/${e.name}`) : e.name.endsWith('.html') ? [`${dir}/${e.name}`] : [],
  );
}

test('/stack/ is built with groups in map order, each with rows, and no zero counts', () => {
  assert.equal(existsSync(STACK), true);
  const doc = page(STACK);
  const groups = find(doc, (e) => 'data-stack-group' in e.attrs).map((e) => e.attrs['data-stack-group']);
  assert.ok(groups.length > 0);
  assert.deepEqual(groups, SKILL_MAP.groups.filter((g) => groups.includes(g)), 'groups follow SKILL_GROUPS');
  for (const h of find(doc, (e) => 'data-stack-group' in e.attrs)) {
    const section = h.parent;
    assert.ok(find(section, (e) => hasClass(e, 'stack-row')).length > 0, `${h.attrs['data-stack-group']} has no rows`);
  }
  const rows = find(doc, (e) => hasClass(e, 'stack-row'));
  for (const r of rows) assert.ok(Number(r.attrs['data-count']) > 0, `${r.attrs.id} counts ${r.attrs['data-count']}`);
  assert.equal(rows.length, evidenced().size, 'one row per evidenced skill');
});

test('/stack/ rows carry data-since and "Since <year>" equal to the skill\'s earliest start year (#274)', () => {
  const rows = find(page(STACK), (e) => hasClass(e, 'stack-row'));
  const byAnchor = new Map([...evidenced().values()].map((r) => [r.anchor, r]));
  assert.equal(rows.length, byAnchor.size);
  for (const row of rows) {
    const skill = byAnchor.get(row.attrs.id);
    assert.ok(skill, `${row.attrs.id} is an evidenced skill`);
    assert.equal(row.attrs['data-since'], String(skill.earliest), `${skill.name} data-since`);
    assert.ok(clean(text(row)).includes(`Since ${skill.earliest}`), `${skill.name} shows Since ${skill.earliest}`);
  }
  const html = readFileSync(STACK, 'utf8');
  assert.equal(html.match(/data-since="[0-9]+"/g)?.length, evidenced().size, 'one data-since per evidenced skill');
});

test('/stack/ counts Python on every Django case study, and Redis on every Celery one (#297)', () => {
  const count = (anchor) => Number(find(page(STACK), (e) => e.attrs.id === anchor)[0]?.attrs['data-count'] ?? 0);
  assert.ok(count('skill-python') >= count('skill-django'), `Python ${count('skill-python')} < Django ${count('skill-django')}`);
  assert.ok(count('skill-redis') >= count('skill-celery'), `Redis ${count('skill-redis')} < Celery ${count('skill-celery')}`);
});

test('/stack/ ids are unique and every row id is its skill anchor', () => {
  const ids = find(page(STACK), (e) => 'id' in e.attrs).map((e) => e.attrs.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  const anchors = [...evidenced().values()].map((r) => r.anchor);
  for (const a of anchors) assert.ok(ids.includes(a), a);
});

test('/stack/ never names a pending client case study', () => {
  const html = readFileSync(STACK, 'utf8');
  for (const slug of pendingSlugs()) assert.equal(html.includes(slug), false, slug);
});

test('/stack/ links to /work/<slug>/ begin with the case study title, and section anchors exist', () => {
  const titles = new Map(projects().map((p) => [p.slug, p.title]));
  const links = find(page(STACK), (e) => e.tag === 'a' && /^\/work\/[^/]+\//.test(e.attrs.href ?? ''));
  assert.ok(links.length > 0);
  for (const a of links) {
    const [, slug, hash] = /^\/work\/([^/]+)\/(?:#(.+))?$/.exec(a.attrs.href);
    const file = `dist/work/${slug}/index.html`;
    assert.ok(existsSync(file), `${a.attrs.href} has no page`);
    assert.ok(clean(text(a)).startsWith(titles.get(slug)), `"${clean(text(a))}" does not begin with ${titles.get(slug)}`);
    if (hash) assert.ok(find(page(file), (e) => e.attrs.id === hash).length === 1, `${a.attrs.href} has no target`);
  }
});

test('/stack/ Latest links show the case-study title and period visibly, with no sr-only wrapper (#324)', () => {
  const rows = find(page(STACK), (e) => hasClass(e, 'stack-row'));
  const byAnchor = new Map([...evidenced().values()].map((r) => [r.anchor, r]));
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const skill = byAnchor.get(row.attrs.id);
    const [latest] = find(row, (e) => hasClass(e, 'stack-latest'));
    assert.ok(latest, `${row.attrs.id} has a Latest item`);
    assert.equal(find(latest, (e) => hasClass(e, 'sr-only')).length, 0, `${row.attrs.id} Latest has no sr-only text`);
    const [a] = find(latest, (e) => e.tag === 'a');
    assert.equal(clean(text(a)), `${skill.latest.title} · ${skill.latest.period}`, `${skill.name} link text`);
    assert.equal(a.attrs.href, skill.latest.href);
    assert.equal(clean(text(latest)), `Latest: ${skill.latest.title} · ${skill.latest.period}`);
  }
});

test('every /stack/#anchor link on the site has a target on /stack/', () => {
  const ids = new Set(find(page(STACK), (e) => 'id' in e.attrs).map((e) => e.attrs.id));
  let seen = 0;
  for (const f of htmlFiles()) {
    for (const a of find(page(f), (e) => e.tag === 'a' && (e.attrs.href ?? '').startsWith('/stack/#'))) {
      seen++;
      assert.ok(ids.has(a.attrs.href.slice('/stack/#'.length)), `${f}: ${a.attrs.href}`);
    }
  }
  assert.ok(seen > 0);
});

test('a marquee word links to /stack/ exactly when its skill has evidence; hidden-copy links skip focus', () => {
  const rows = evidenced();
  const lists = find(page('dist/index.html'), (e) => hasClass(e, 'marquee-list'));
  assert.equal(lists.length, 2);
  for (const [i, list] of lists.entries()) {
    const items = find(list, (e) => hasClass(e, 'marquee-item'));
    assert.equal(items.length, MARQUEE.length);
    items.forEach((li, j) => {
      const row = rows.get(resolveWord(SKILL_MAP, MARQUEE[j])[0].name);
      const link = find(li, (e) => e.tag === 'a');
      if (row) {
        assert.equal(link.length, 1, `${MARQUEE[j]} should link`);
        assert.equal(link[0].attrs.href, `/stack/#${row.anchor}`);
        assert.equal(link[0].attrs.tabindex, i === 1 ? '-1' : undefined, `${MARQUEE[j]} copy ${i} tabindex`);
      } else assert.equal(link.length, 0, `${MARQUEE[j]} has no evidence and should be plain text`);
    });
  }
  assert.equal(lists[1].attrs['aria-hidden'], 'true');
});

test('home About shows the skills matrix and links to /stack/', () => {
  const doc = page('dist/index.html');
  const [about] = find(doc, (e) => e.attrs.id === 'skills');
  assert.ok(about, 'home has #skills');
  assert.equal(find(about, (e) => 'data-skill-matrix' in e.attrs).length, 1);
  assert.ok(find(about, (e) => e.tag === 'a' && e.attrs.href === '/stack/').length === 1);
  const items = find(about, (e) => 'data-skill' in e.attrs);
  assert.equal(items.length, evidenced().size);
  assert.equal(/since/i.test(text(about)), false, 'home matrix leaves showSince off (#274)');
});

test('the CV skills block is compact: at most 24 skills, 800 characters, no periods', () => {
  const html = readFileSync('dist/cv/index.html', 'utf8');
  const from = html.indexOf('id="cv-skills"');
  assert.notEqual(from, -1);
  // The caveat note (#323) follows the matrix; the budget is for the matrix alone.
  const block = html.slice(from, html.indexOf('<p class="cv-skills-note"', from));
  const items = block.match(/data-skill="/g) ?? [];
  assert.ok(items.length > 0 && items.length <= 24, `${items.length} skills`);
  const words = clean(stripTags(block));
  // 800, raised from 700 (#274): " · since YYYY" adds 13 characters to each of up to 24 items
  // (about 450 -> 760). The two-page PDF test in tests/cv.test.mjs is the real length limit.
  assert.ok(words.length <= 800, `${words.length} characters`);
  assert.equal(block.includes('cv-period'), false);
  assert.equal(block.includes('href="/stack/'), false, 'the CV matrix is unlinked');
});

test('each CV skill count reads "×<count> · since <earliest>" (#274)', () => {
  const doc = page('dist/cv/index.html');
  const [heading] = find(doc, (e) => e.attrs.id === 'cv-skills');
  assert.ok(heading, '/cv/ has #cv-skills');
  const items = find(heading.parent, (e) => 'data-skill' in e.attrs);
  assert.ok(items.length > 0 && items.length <= 24, `${items.length} skills`);
  const rows = evidenced();
  for (const item of items) {
    const skill = rows.get(item.attrs['data-skill']);
    assert.ok(skill, `${item.attrs['data-skill']} is an evidenced skill`);
    const spans = find(item, (e) => hasClass(e, 'skill-count'));
    assert.equal(spans.length, 1, `${skill.name} has one .skill-count`);
    assert.equal(clean(text(spans[0])), `×${skill.count} · since ${skill.earliest}`, skill.name);
  }
});
