// Ongoing MTS periods read "<start with a year> – Present", never a frozen end month.
// Static: frontmatter is read from source and the built pages are read from dist/; nothing here
// reads the clock, because the site rebuilds daily (ADR 0003). Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projects } from './lib/projects.mjs';
import { earliestYear } from '../src/lib/work-order.ts';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const read = (p) => readFileSync(p, 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
// agentic-workflow is category "tool", so it is named explicitly rather than found by category.
const ongoing = () => projects().filter((p) => p.category === 'mts' || p.slug === 'agentic-workflow');

test('the ongoing set is the MTS case studies plus agentic-workflow', () => {
  const slugs = ongoing().map((p) => p.slug);
  for (const s of ['mts-hub', 'wetlabs-app', 'agentic-workflow']) assert.ok(slugs.includes(s), `${s} missing`);
});

test('ongoing case-study periods are "<start with a year> – Present" and keep no frozen end', () => {
  for (const p of ongoing()) {
    assert.match(p.period, /^(?:[A-Z][a-z]{2} )?\d{4} – Present$/, `${p.slug}: ${p.period}`);
    assert.equal(p.period.includes('Oct 2026'), false, `${p.slug}: ${p.period}`);
  }
});

// Since #168 MTS is one Timeline row, derived from cv.md, carrying the now marker.
test('home timeline: the now row is Aug 2025 – Present and no period has a frozen Oct 2026 end', () => {
  const html = read('dist/index.html');
  const timeline = html.match(/<ol class="timeline[\s\S]*?<\/ol>/)?.[0] ?? '';
  const nowRow = timeline.match(/<li class="timeline-row timeline-now"[\s\S]*?<\/li>/)?.[0] ?? '';
  const nowPeriod = nowRow.match(/text-lime"[^>]*>([^<]*)</)?.[1];
  assert.equal(nowPeriod, 'Aug 2025 – Present');
  const periods = [...timeline.matchAll(/text-lime"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.ok(periods.length > 0, 'no timeline periods');
  for (const p of periods) assert.equal(p.includes('Oct 2026'), false, p);
});

test('case study pages show the Present period', () => {
  assert.ok(read('dist/work/mts-hub/index.html').includes('Jul 2026 – Present'));
  assert.ok(read('dist/work/agentic-workflow/index.html').includes('Jul 2026 – Present'));
  assert.ok(read('dist/work/wetlabs-app/index.html').includes('Aug 2025 – Present'));
});

test('/cv/ still shows the MTS case studies as a start only', () => {
  const periods = [...read('dist/cv/index.html').matchAll(/class="cv-period"[^>]*>([^<]*)/g)].map((m) => m[1].trim());
  assert.ok(periods.includes('Jul 2026'), periods.join(' | '));
  assert.ok(periods.includes('Aug 2025'), periods.join(' | '));
});

test('earliestYear ignores "Present" and keeps the year of an ongoing period', () => {
  assert.equal(earliestYear(['Jul 2026 – Present', '2022 – 2026']), 2022);
  assert.equal(earliestYear(['Jul 2026 – Present']), 2026);
});

// The freelance client track is ongoing (issue #189): every page that dates it says the same thing.
const CLIENT_PERIOD = 'Aug 2026 – Present';
const clientSlugs = ['east-coast-blinds', 'dublin-plein-air'];

test('client case-study frontmatter gives the freelance period, matching the CV entry', () => {
  const cv = read('src/content/cv/cv.md');
  assert.match(cv, new RegExp(`title: Freelance Software Engineer[\\s\\S]*?period: ${CLIENT_PERIOD}`));
  for (const slug of clientSlugs) {
    const p = projects().find((x) => x.slug === slug);
    assert.ok(p, `${slug} missing`);
    assert.equal(p.period, CLIENT_PERIOD, slug);
  }
});

test('home timeline, /work/ cards, case pages and /cv/ all tell the client track as ongoing', () => {
  const home = read('dist/index.html');
  const timeline = home.match(/<ol class="timeline[\s\S]*?<\/ol>/)?.[0] ?? '';
  const row = [...timeline.matchAll(/<li[\s\S]*?<\/li>/g)].map((m) => text(m[0])).find((r) => r.includes('Freelance Software Engineer'));
  assert.ok(row, 'client timeline row missing');
  assert.ok(row.includes(CLIENT_PERIOD), row);
  assert.equal(row.includes('Oct 2026'), false, row);
  const work = text(read('dist/work/index.html'));
  for (const slug of clientSlugs) {
    assert.ok(text(read(`dist/work/${slug}/index.html`)).includes(CLIENT_PERIOD), `${slug} page`);
  }
  assert.ok(work.includes(CLIENT_PERIOD), '/work/ cards');
  assert.equal(/Aug – Oct 2026/.test(work), false, '/work/ still has a frozen end');
  const periods = [...read('dist/cv/index.html').matchAll(/class="cv-period"[^>]*>([^<]*)/g)].map((m) => m[1].trim());
  assert.equal(periods[0], CLIENT_PERIOD, periods.join(' | '));
});

test('East Coast Blinds body keeps the cutover as still ahead, consistent with an open period', () => {
  const body = text(read('dist/work/east-coast-blinds/index.html'));
  assert.ok(body.includes('The swap itself is still ahead'));
});

// Issue #327: the CV's first freelance entry is a role window that ends when MTS starts, while the
// m-buildz shop it names is still kept running, so the two dates must not contradict each other.
test('m-buildz is dated as ongoing and the CV entry that says "still keep it running" ends before MTS', () => {
  const p = projects().find((x) => x.slug === 'm-buildz');
  assert.ok(p, 'm-buildz missing');
  assert.equal(p.period, 'Nov 2024 – Present');
  const cvPage = text(read('dist/cv/index.html'));
  assert.ok(cvPage.includes('May 2024 – 2025'), 'CV freelance role window');
  assert.ok(cvPage.includes('still keep it running, alongside MTS'), 'CV says the shop outlives the role window');
  assert.ok(text(read('dist/work/m-buildz/index.html')).includes('Nov 2024 – Present'), 'case-study page period');
});
