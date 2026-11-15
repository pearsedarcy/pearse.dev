// The Open Graph card selection in scripts/og-cards.mjs, fed fixture entries (#278): no build,
// no browser. tests/og.test.mjs checks the real cards against the built pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { STATIC_PAGE_SLUGS, selectCards } from '../scripts/og-cards.mjs';

const MODULE = new URL('../scripts/og-cards.mjs', import.meta.url);
const NOW = new Date('2026-11-15T12:00:00Z');
const nowEntry = (updated = '2026-10-01') => ({ file: 'now.md', data: { updated }, body: '' });
const post = (file, data = {}) => ({ file, data: { title: 'A fixture article', pubDate: '2026-01-01', ...data }, body: 'Fixture body.' });

test('the static-page slugs are cv, stack and now', () => {
  assert.deepEqual(STATIC_PAGE_SLUGS, ['cv', 'stack', 'now']);
});

test('fixture entries give one article card and the three page cards', () => {
  const cards = selectCards({ now: NOW, posts: [post('fixture.md'), post('later.md', { pubDate: '2027-01-01' })], projects: [], nowEntry: nowEntry() });
  assert.deepEqual(
    cards.map((c) => [c.slug, c.kind, c.tag]),
    [['fixture', 'article', 'Writing'], ['cv', 'page', 'CV'], ['stack', 'page', 'Stack'], ['now', 'page', 'Now']],
  );
  const kicker = Object.fromEntries(cards.map((c) => [c.slug, c.kicker]));
  assert.equal(kicker.cv, 'Software engineer / Innsbruck');
  assert.equal(kicker.stack, '0 skills');
  assert.equal(kicker.now, 'Updated October 2026');
});

for (const slug of STATIC_PAGE_SLUGS) {
  test(`an article with the slug "${slug}" fails with the collision error`, () => {
    assert.throws(
      () => selectCards({ now: NOW, posts: [post(`${slug}.md`)], projects: [], nowEntry: nowEntry() }),
      new RegExp(`share the slug "${slug}".*/og/${slug}\\.png would collide`),
    );
    assert.throws(
      () => selectCards({ now: NOW, posts: [post('other.md', { slug })], projects: [], nowEntry: nowEntry() }),
      /would collide/,
    );
  });
}

test('a slug that is not URL-safe still fails', () => {
  assert.throws(() => selectCards({ now: NOW, posts: [post('Bad Slug.md')], projects: [], nowEntry: nowEntry() }), /not URL-safe/);
});

test('a bad now date fails rather than printing "Invalid Date"', () => {
  assert.throws(() => selectCards({ now: NOW, posts: [], projects: [], nowEntry: nowEntry('soon') }), /bad date/);
});

// A start-of-month date read in local time shows the previous month west of UTC. Each run is a
// child process, so TZ is set before anything reads it.
for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
  test(`a now entry dated 2026-10-01 gives "Updated October 2026" under TZ=${tz}`, () => {
    const code = `
      const { selectCards } = await import(${JSON.stringify(MODULE.href)});
      const cards = selectCards({ posts: [], projects: [], nowEntry: { file: 'now.md', data: { updated: '2026-10-01' } } });
      process.stdout.write(JSON.stringify({ kicker: cards.find((c) => c.slug === 'now').kicker, localMonth: new Date('2026-10-01').getMonth() }));
    `;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
    assert.equal(out.kicker, 'Updated October 2026');
    if (tz.startsWith('America/') || tz === 'Pacific/Pago_Pago') assert.equal(out.localMonth, 8, `${tz} did not take effect`);
  });
}

test('the module has no side effects at import and reuses the shared helpers', () => {
  const src = readFileSync(MODULE, 'utf8');
  assert.doesNotMatch(src, /\b(rmSync|mkdirSync|writeFileSync|process\.exit|launch)\b/);
  assert.match(src, /countSkills\(/);
  assert.match(src, /formatMonthYear\(/);
  assert.match(src, /countNoun\(/);
  assert.doesNotMatch(src, /rows\.length/, 'count skills with countSkills, not by hand');
  assert.doesNotMatch(src, /Intl\.DateTimeFormat/, 'format the month with formatMonthYear');
});

test('/stack/ and /now/ use the same helpers as the card module', () => {
  const stack = readFileSync(new URL('../src/pages/stack.astro', import.meta.url), 'utf8');
  assert.match(stack, /countSkills\(groups\)/);
  assert.doesNotMatch(stack, /rows\.length/);
  const now = readFileSync(new URL('../src/pages/now.astro', import.meta.url), 'utf8');
  // #289: /now/ formats through updatedLabel (src/lib/updated.ts), which delegates to formatMonthYear.
  assert.match(now, /updatedLabel\(updated\)/);
  assert.match(readFileSync(new URL('../src/lib/updated.ts', import.meta.url), 'utf8'), /return formatMonthYear\(date\)/);
  assert.doesNotMatch(now, /Intl\.DateTimeFormat/);
});

test('the default card and the CV card share one role kicker', () => {
  const image = readFileSync(new URL('../scripts/og-image.mjs', import.meta.url), 'utf8');
  assert.match(image, /ROLE_KICKER/);
  assert.doesNotMatch(image, /Software engineer \/ Innsbruck/);
});
