// The skills map (#163): the pure module (src/lib/skill-map.ts) on fixtures, then drift checks of the
// map in src/lib/site.ts against the case-study sources and the LinkedIn Skills list. Reads sources
// only, no dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildSkillGroups,
  compareLatest,
  limitRows,
  periodBounds,
  resolveWord,
  skillAnchor,
  skillsForStack,
  stackStrings,
} from '../src/lib/skill-map.ts';
import { isCaseStudy } from '../src/lib/visibility.ts';
import { MARQUEE, SKILL_MAP } from '../src/lib/site.ts';
import { projects } from './lib/projects.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const end = (period) => periodBounds(period, 'fixture').end;
const start = (period) => periodBounds(period, 'fixture').start;

/** A fixture case study: visible tool by default. */
const proj = (slug, period, stack, extra = {}) => ({ slug, title: slug.toUpperCase(), period, order: 1, category: 'tool', stack, ...extra });

const CONFIG = {
  groups: ['Backend', 'Data', 'Practices'],
  skills: [
    { name: 'Django', group: 'Backend', aliases: ['Django 5'] },
    { name: 'Celery', group: 'Backend', aliases: ['Celery + Redis'] },
    { name: 'Zig', group: 'Backend' },
    { name: 'Redis', group: 'Data', aliases: ['Celery + Redis'] },
    { name: 'GDPR', group: 'Practices' },
  ],
  ignore: [],
};

// Period order ---------------------------------------------------------------------------------

test('period end: the text after the dash, or the whole string; a shared year belongs to the end', () => {
  assert.equal(end('Aug 2025'), end('Mar 2024 – Aug 2025'), '"Aug 2025" ends at Aug 2025');
  assert.equal(end('Jul – Oct 2026'), end('Oct 2026'), '"Jul – Oct 2026" ends at Oct 2026');
  assert.equal(start('Jul – Oct 2026'), end('Jul 2026'), '"Jul – Oct 2026" starts at Jul 2026');
  assert.equal(end('Aug – Sep 2026'), end('Sep 2026'), '"Aug – Sep 2026" ends at Sep 2026');
});

test('period end: a year-only end ranks as month 0, and Present ranks above every date', () => {
  assert.ok(end('Nov 2024 – 2026') < end('Jan 2026'), '"Nov 2024 – 2026" below "Jan 2026"');
  assert.ok(end('Nov 2024 – 2026') < end('Sep 2026'), '"Nov 2024 – 2026" below "Sep 2026"');
  assert.ok(end('Aug 2025 – Present') > end('Oct 2026'), '"Aug 2025 – Present" above "Oct 2026"');
  assert.ok(end('2022 – 2026') > end('Nov 2025'), 'a year-only end ranks above the previous year');
  assert.equal(start('2022 – 2026'), end('2022'), 'a year-only start is month 0 too');
});

test('tie-breaks: equal ends fall to the later start, then the lower order, then the slug', () => {
  const sorted = (...ps) => ps.sort(compareLatest).map((p) => p.slug);
  assert.deepEqual(sorted(proj('a', 'Jan – Oct 2026', []), proj('b', 'Sep – Oct 2026', [])), ['b', 'a'], 'later start');
  assert.deepEqual(sorted(proj('a', 'Oct 2026', [], { order: 5 }), proj('b', 'Oct 2026', [], { order: 2 })), ['b', 'a'], 'lower order');
  assert.deepEqual(sorted(proj('b', 'Oct 2026', []), proj('a', 'Oct 2026', [])), ['a', 'b'], 'slug');
  assert.deepEqual(sorted(proj('a', 'Aug 2025 – Present', []), proj('b', 'Jul 2026 – Present', [])), ['b', 'a'], 'two Presents');
  assert.deepEqual(sorted(proj('a', 'Oct 2026', []), proj('b', 'Nov 2024 – 2026', [])), ['a', 'b'], 'year-only end ranks low');
});

test('an unparseable period throws, naming the string and the slug', () => {
  for (const bad of ['Summer 2025', 'Present', 'Jul – Present', '2025 –', 'Aug 2025 – Sep 2026 – Present', 'Aug', 'Jul – Oct', 'Sept 2025', '']) {
    assert.throws(
      () => periodBounds(bad, 'some-slug'),
      (e) => e.message.includes(`"${bad}"`) && e.message.includes('some-slug'),
      JSON.stringify(bad),
    );
  }
  assert.throws(() => buildSkillGroups(CONFIG, [proj('x', 'Spring 2026', ['Django'])], () => true), /"Spring 2026".*"x"/);
});

// Grouping -------------------------------------------------------------------------------------

test('the displayed latest period is the winner\'s own period text, linking to the winner', () => {
  const groups = buildSkillGroups(
    CONFIG,
    [proj('old', 'Aug 2025', ['Django']), proj('range', 'Jul – Oct 2026', ['Django 5']), proj('year', 'Nov 2024 – 2026', ['Django'])],
    () => true,
  );
  const django = groups[0].rows[0];
  assert.equal(django.latest.period, 'Jul – Oct 2026');
  assert.equal(django.latest.href, '/work/range/');
  assert.equal(django.latest.title, 'RANGE');
  assert.deepEqual(django.evidence.map((e) => e.slug), ['range', 'year', 'old'], 'latest first');
});

test('output shape: groups in config order, rows in list order, empty skills and groups left out', () => {
  const groups = buildSkillGroups(CONFIG, [proj('a', 'Oct 2026', ['Celery + Redis', 'Django 5'])], () => true);
  assert.deepEqual(groups.map((g) => g.name), ['Backend', 'Data'], 'Practices has no evidence and disappears');
  assert.deepEqual(groups[0].rows.map((r) => r.name), ['Django', 'Celery'], 'Zig has no evidence and gets no row');
  const row = groups[0].rows[0];
  assert.deepEqual(Object.keys(row).sort(), ['anchor', 'count', 'evidence', 'group', 'index', 'latest', 'name']);
  assert.equal(row.anchor, 'skill-django');
  assert.equal(row.count, 1);
  assert.deepEqual(row.evidence, [{ slug: 'a', title: 'A', period: 'Oct 2026', links: [{ href: '/work/a/', text: 'A' }] }]);
  assert.deepEqual(groups[1].rows.map((r) => r.name), ['Redis'], 'one stack string evidences two skills');
});

test('visibility: a pending client case study contributes no skill, no count and no link', () => {
  const pending = proj('secret-client', 'Oct 2026', ['Zig', 'Django'], { category: 'client', clientPermission: 'pending' });
  const shown = proj('shown', 'Aug 2025', ['Django']);
  const smaller = proj('smaller', 'Aug 2025', ['Django'], { smallerBuild: true });
  const groups = buildSkillGroups(CONFIG, [pending, shown, smaller], isCaseStudy);
  const rows = groups.flatMap((g) => g.rows);
  assert.equal(rows.some((r) => r.name === 'Zig'), false, 'its unique skill has no row');
  const django = rows.find((r) => r.name === 'Django');
  assert.equal(django.count, 1, 'its shared skill does not count it');
  assert.equal(JSON.stringify(groups).includes('secret-client'), false, 'no link or mention');
  assert.equal(JSON.stringify(groups).includes('/work/smaller/'), false, 'a smaller build has no page to link');
});

test('counting: a case study naming a skill in its stack and a section counts once, linked whole', () => {
  const p = proj('hub', 'Jul 2026 – Present', ['Celery'], {
    sections: [
      { id: 'packing', title: 'Packing', stack: ['Celery + Redis'] },
      { id: 'reports', title: 'Reports', stack: ['Celery'] },
    ],
  });
  const rows = buildSkillGroups(CONFIG, [p], () => true).flatMap((g) => g.rows);
  const celery = rows.find((r) => r.name === 'Celery');
  assert.equal(celery.count, 1);
  assert.deepEqual(celery.evidence[0].links, [{ href: '/work/hub/', text: 'HUB' }]);
  const redis = rows.find((r) => r.name === 'Redis');
  assert.equal(redis.count, 1);
  assert.deepEqual(redis.evidence[0].links, [{ href: '/work/hub/#packing', text: 'HUB, Packing' }], 'section-only evidence');
  assert.equal(redis.latest.href, '/work/hub/#packing');
});

test('skillAnchor: skill- plus a lowercase slug, each run of non-alphanumerics one hyphen', () => {
  assert.equal(skillAnchor('Three.js'), 'skill-three-js');
  assert.equal(skillAnchor('Django REST Framework'), 'skill-django-rest-framework');
  assert.equal(skillAnchor('AI/ML  agents.'), 'skill-ai-ml-agents');
});

test('a config with an unknown group, a repeated name or a repeated anchor fails', () => {
  const bad = (skills) => () => buildSkillGroups({ groups: ['Backend'], skills, ignore: [] }, [], () => true);
  assert.throws(bad([{ name: 'X', group: 'Nope' }]), /unknown group/);
  assert.throws(bad([{ name: 'X', group: 'Backend' }, { name: 'X', group: 'Backend' }]), /twice/);
  assert.throws(bad([{ name: 'Three.js', group: 'Backend' }, { name: 'Three js', group: 'Backend' }]), /anchor/);
});

test('limitRows keeps the first rows in skill-list order and drops emptied groups', () => {
  const groups = buildSkillGroups(CONFIG, [proj('a', 'Oct 2026', ['Django', 'Celery + Redis', 'Zig'])], () => true);
  const limited = limitRows(groups, 2);
  assert.deepEqual(limited.map((g) => [g.name, g.rows.map((r) => r.name)]), [['Backend', ['Django', 'Celery']]]);
});

// Drift: the map in site.ts against the sources ----------------------------------------------

const caseStudies = () => projects().filter((p) => p.caseStudy);
const allStrings = () => new Set(caseStudies().flatMap(stackStrings));

test('every stack and section-stack string of every case study maps to a skill or is ignored', () => {
  const unmapped = [...allStrings()].filter((s) => !skillsForStack(SKILL_MAP, s).length && !SKILL_MAP.ignore.includes(s));
  assert.deepEqual(unmapped, [], 'add an alias with a comment, or an ignore entry, in src/lib/site.ts');
});

test('no alias or ignore entry is stale, and no ignored string is also a skill', () => {
  const strings = allStrings();
  for (const s of SKILL_MAP.skills) for (const a of s.aliases ?? []) assert.ok(strings.has(a), `stale alias "${a}" on ${s.name}`);
  for (const i of SKILL_MAP.ignore) {
    assert.ok(strings.has(i), `stale ignore entry "${i}"`);
    assert.deepEqual(skillsForStack(SKILL_MAP, i), [], `"${i}" is both ignored and a skill`);
  }
  assert.equal(new Set(SKILL_MAP.ignore).size, SKILL_MAP.ignore.length, 'duplicate ignore entry');
});

/** The numbered "## Skills" list of the LinkedIn profile doc, in order. */
function linkedinSkills() {
  const md = readFileSync('docs/profile/linkedin.md', 'utf8');
  const from = md.indexOf('\n## Skills');
  assert.notEqual(from, -1, 'docs/profile/linkedin.md has a "## Skills" section');
  const body = md.slice(from + 1).split(/\n## /)[0];
  return [...body.matchAll(/^\d+\.\s+(.+?)\s*$/gm)].map((m) => m[1]);
}

test('skill-list order follows the LinkedIn Skills list, and listed skills lead each group', () => {
  const listed = linkedinSkills();
  assert.ok(listed.length > 0);
  const names = SKILL_MAP.skills.map((s) => s.name);
  for (const l of listed) assert.equal(names.filter((n) => n === l).length, 1, `LinkedIn skill "${l}" is in the map once`);
  assert.deepEqual(
    names.filter((n) => listed.includes(n)),
    listed,
    'listed skills keep the LinkedIn order',
  );
  for (const g of SKILL_MAP.groups) {
    const inGroup = SKILL_MAP.skills.filter((s) => s.group === g).map((s) => listed.includes(s.name));
    const firstOff = inGroup.indexOf(false);
    assert.ok(firstOff === -1 || !inGroup.slice(firstOff).includes(true), `${g}: a listed skill follows an unlisted one`);
  }
});

test('the real map builds: every group known, anchors unique, every period parses', () => {
  const groups = buildSkillGroups(SKILL_MAP, projects(), isCaseStudy);
  const order = SKILL_MAP.groups.filter((g) => groups.some((x) => x.name === g));
  assert.deepEqual(groups.map((g) => g.name), order);
  const anchors = groups.flatMap((g) => g.rows.map((r) => r.anchor));
  assert.equal(new Set(anchors).size, anchors.length);
  for (const r of groups.flatMap((g) => g.rows)) assert.ok(r.count > 0, r.name);
});

// Marquee --------------------------------------------------------------------------------------

test('every marquee word resolves, by name, alias or label, to exactly one skill', () => {
  for (const w of MARQUEE) assert.equal(resolveWord(SKILL_MAP, w).length, 1, `"${w}" resolves to ${resolveWord(SKILL_MAP, w).map((s) => s.name)}`);
});

test('labels are never evidence: a stack string equal only to a label maps to no skill', () => {
  for (const s of SKILL_MAP.skills) {
    for (const l of s.labels ?? []) assert.equal(skillsForStack(SKILL_MAP, l).includes(s), false, `${s.name} label "${l}"`);
  }
});
