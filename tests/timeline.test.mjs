// Issue #168: the home Timeline is derived from src/content/cv/cv.md by src/lib/timeline.ts, so it
// cannot contradict the CV. Unit tests run the pure function on the real cv.md and on fixtures;
// the dist tests read the built home page and /cv/. Relies on `npm test`'s pretest build;
// run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cvData, cvTimeline } from './lib/cv.mjs';
import { timelineRows } from '../src/lib/timeline.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const read = (p) => readFileSync(p, 'utf8');
const text = (html) =>
  html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const PERIODS = ['Age 14', 'From 2014', '2022', 'Nov 2023 – Apr 2024', 'May 2024 – 2025', 'Aug 2025 – Present', 'Aug 2026 – Present'];
const MTS = 'MTS – The Wetlab Company';

// ---- the function on the real cv.md ----

test('the CV gives 7 Timeline rows, oldest first, in the pinned period order', () => {
  const rows = cvTimeline();
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r.period), PERIODS);
});

test('every experience, education and before entry has a timeline headline', () => {
  const cv = cvData();
  for (const e of [...cv.experience, ...cv.education, ...(cv.before ?? [])]) {
    assert.equal(typeof e.timeline?.headline, 'string', `${e.title}: no timeline.headline`);
    assert.ok(e.timeline.headline.length > 0, `${e.title}: empty timeline.headline`);
  }
});

test('exactly one row is now: the MTS row, ending "– Present", with the two products as sub-items', () => {
  const now = cvTimeline().filter((r) => r.now);
  assert.equal(now.length, 1);
  assert.equal(now[0].organisation, MTS);
  assert.match(now[0].period, / – Present$/);
  assert.deepEqual(now[0].products.map((p) => p.name), ['MTS Hub', 'wetlabs.app']);
  assert.doesNotMatch(JSON.stringify(now[0]), /client/i);
});

test('context is "title, organisation" for CV entries and the milestone context otherwise', () => {
  assert.deepEqual(cvTimeline().map((r) => r.context), [
    'Legion Airsoft',
    'Professional downhill skateboarder, IDF World Tour',
    'Skatedownhills',
    'Full-stack diploma, Code Institute',
    'Freelance Web Developer, Self-employed',
    `Software Engineer, ${MTS}`,
    'Freelance Software Engineer, Self-employed',
  ]);
});

test('the Age 14 milestone orders by the 1900 placeholder and shows "Age 14"', () => {
  const m = cvData().milestones.find((x) => x.context === 'Legion Airsoft');
  assert.equal(m.sortYear, 1900);
  const rows = cvTimeline();
  const row = rows.find((r) => r.context === 'Legion Airsoft');
  assert.equal(row.period, 'Age 14');
  assert.equal(row.organisation, undefined);
  assert.equal(rows[0], row, 'oldest row');
});

// ---- no overlapping rows for one organisation ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A period as an inclusive [first, last] month interval, months counted from year 0. */
function interval(period) {
  const [start, end] = period.split(' – ');
  const s = start.match(/^(From )?(?:([A-Z][a-z]{2}) )?(\d{4})$/);
  assert.ok(s, `cannot parse start of "${period}"`);
  const year = Number(s[3]);
  const first = year * 12 + (s[2] ? MONTHS.indexOf(s[2]) : 0);
  if (end === undefined) {
    if (s[1]) return [first, Infinity]; // "From YYYY": open-ended
    return [first, s[2] ? first : year * 12 + 11]; // bare "YYYY": Jan–Dec of that year
  }
  if (end === 'Present') return [first, Infinity];
  const e = end.match(/^(?:([A-Z][a-z]{2}) )?(\d{4})$/);
  assert.ok(e, `cannot parse end of "${period}"`);
  return [first, Number(e[2]) * 12 + (e[1] ? MONTHS.indexOf(e[1]) : 11)]; // bare "YYYY": December
}

/** Pairs of rows from one organisation whose periods overlap; milestones are skipped. */
function overlaps(rows) {
  const found = [];
  const cv = rows.filter((r) => r.organisation !== undefined);
  for (let i = 0; i < cv.length; i++) {
    for (let j = i + 1; j < cv.length; j++) {
      if (cv[i].organisation !== cv[j].organisation) continue;
      const [a1, a2] = interval(cv[i].period);
      const [b1, b2] = interval(cv[j].period);
      if (a1 <= b2 && b1 <= a2) found.push(`${cv[i].period} / ${cv[j].period} (${cv[i].organisation})`);
    }
  }
  return found;
}

test('no two rows with the same organisation have overlapping periods', () => {
  assert.deepEqual(overlaps(cvTimeline()), []);
});

test('the overlap check catches the old four overlapping MTS rows', () => {
  const row = (period) => ({ period, organisation: MTS });
  assert.equal(overlaps([row('Aug 2025 – Present'), row('Jul 2026 – Present')]).length, 1);
  assert.equal(overlaps([row('May 2024 – 2025'), row('Dec 2025 – Present')]).length, 1);
  assert.deepEqual(overlaps([row('May 2024 – 2025'), row('Jan 2026 – Present')]), []);
  assert.deepEqual(overlaps([row('2022'), row('2023')]), []);
});

// ---- fixtures: the function refuses a malformed CV ----

const entry = (period, timeline, extra = {}) => ({ title: 'T', organisation: 'O', period, timeline, ...extra });
const fixture = (experience, milestones = []) => ({ experience, education: [], before: [], milestones });

test('it throws when no entry is marked now', () => {
  assert.throws(() => timelineRows(fixture([entry('Aug 2025 – Present', { headline: 'h' })])), /exactly one/);
});

test('it throws when two entries are marked now', () => {
  const both = [entry('Aug 2025 – Present', { headline: 'a', now: true }), entry('Aug 2026 – Present', { headline: 'b', now: true })];
  assert.throws(() => timelineRows(fixture(both)), /exactly one/);
});

test('it throws when the now entry does not end "– Present"', () => {
  assert.throws(() => timelineRows(fixture([entry('May 2024 – 2025', { headline: 'h', now: true })])), /Present/);
});

test('it throws on "Jul – Present" with no sortYear', () => {
  const rows = [entry('Aug 2025 – Present', { headline: 'h', now: true }), entry('Jul – Present', { headline: 'typo' })];
  assert.throws(() => timelineRows(fixture(rows)), /Jul – Present/);
  const milestone = { period: 'Jul – Present', context: 'c', headline: 'h' };
  assert.throws(() => timelineRows(fixture([rows[0]], [milestone])), /no year and no sortYear/);
});

test('fixture: equal start keys keep source order, and only products with a timeline become sub-items', () => {
  const now = entry('2020 – Present', { headline: 'n', now: true }, {
    products: [{ name: 'A', timeline: { headline: 'a' } }, { name: 'B' }],
  });
  const rows = timelineRows(fixture([now], [{ period: '2020', context: 'm', headline: 'm' }]));
  assert.deepEqual(rows.map((r) => r.context), ['T, O', 'm']);
  assert.deepEqual(rows[0].products, [{ name: 'A', headline: 'a' }]);
});

// ---- the built pages ----

const timelineOl = () => read('dist/index.html').match(/<ol class="timeline"[\s\S]*?<\/ol>/)?.[0] ?? '';

test('dist: 7 rows, one timeline-now on the Aug 2025 – Present MTS row, no client wording in it', () => {
  const ol = timelineOl();
  assert.equal((ol.match(/<li\b/g) ?? []).length, 7);
  assert.equal((ol.match(/timeline-now/g) ?? []).length, 1);
  const nowRow = ol.match(/<li class="timeline-row timeline-now"[\s\S]*?<\/li>/)?.[0] ?? '';
  assert.match(nowRow, /Aug 2025 – Present/);
  assert.match(nowRow, /MTS Hub/);
  assert.match(nowRow, /wetlabs\.app/);
  assert.doesNotMatch(nowRow, /client/i);
});

test('dist: product sub-items hold no <li> and no <span>, and the Timeline has no "Oct 2026" or "939"', () => {
  const ol = timelineOl();
  const products = [...ol.matchAll(/<div class="timeline-products"[\s\S]*?<\/div>/g)].map((m) => m[0]);
  assert.equal(products.length, 1, 'one row with products');
  for (const p of products) {
    assert.doesNotMatch(p, /<li\b/);
    assert.doesNotMatch(p, /<span\b/);
  }
  assert.doesNotMatch(ol, /Oct 2026/);
  assert.doesNotMatch(ol, /939/);
});

test('dist: milestone headlines are on the home Timeline and not on /cv/', () => {
  const cv = text(read('dist/cv/index.html'));
  const home = text(timelineOl());
  for (const m of cvData().milestones) {
    assert.ok(home.includes(m.headline), `home is missing "${m.headline}"`);
    assert.equal(cv.includes(m.headline), false, `/cv/ shows "${m.headline}"`);
  }
  assert.equal(cv.includes('while injured'), false);
  assert.ok(home.includes('while injured'));
});
