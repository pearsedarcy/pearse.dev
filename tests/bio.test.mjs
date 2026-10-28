// Issue #42: the person behind the work. The home About section, /cv/ and /now/ tell the same
// arc (first website at 14, the skating record, Skatedownhills) and list the same hobbies, and the
// CV presents MTS as exactly two products.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const read = (path) => readFileSync(path, 'utf8');

/** Visible text: tags dropped, the entities Astro emits decoded, whitespace collapsed. */
const text = (html) =>
  html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const about = () => read('dist/index.html').match(/<section id="about"[\s\S]*?<\/section>/)?.[0] ?? '';
const cv = () => read('dist/cv/index.html');
const now = () => read('dist/now/index.html');

const PAGES = {
  'home About section': about,
  '/cv/': cv,
  '/now/': now,
};

// Hard-coded on purpose: this is the list from the issue, not a copy of src/lib/site.ts.
const HOBBIES = ['Downhill mountain biking', 'Snowboarding', 'Road biking', 'Table tennis', 'Billiards', 'Gardening', 'Film and TV'];

const ARC = [
  ['Legion Airsoft', /Legion Airsoft/],
  ['the 2019 European 2nd place', /2nd overall in the 2019 (IDF )?European rankings/],
  ['the BDSL title', /BDSL[^.]*champion/],
  ['Skatedownhills', /Skatedownhills/],
];

for (const [name, page] of Object.entries(PAGES)) {
  test(`${name} tells the arc: Legion Airsoft, the skating record and Skatedownhills`, () => {
    const t = text(page());
    assert.ok(t.length > 0, `${name} is empty`);
    for (const [label, re] of ARC) assert.match(t, re, `${name}: ${label}`);
  });

  test(`${name} lists every hobby`, () => {
    const t = text(page()).toLowerCase();
    for (const h of HOBBIES) assert.ok(t.includes(h.toLowerCase()), `${name}: ${h}`);
  });

  test(`${name} links the Skatedownhills case study`, () => {
    assert.match(page(), /href="\/work\/skatedownhills\/"/, name);
  });
}

// Tools folded into the two MTS products, and the old product name: never named on these pages.
const NOT_PRODUCTS = /WetPack|Opthalyze|\bAtlas\b|\bCortex\b|Ophthix|Observability stack/i;

test('/cv/ names exactly two MTS products: MTS Hub and wetlabs.app', () => {
  const page = cv();
  const products = [...page.matchAll(/class="cv-product-name"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(products, ['MTS Hub', 'wetlabs.app']);
  assert.doesNotMatch(text(page), NOT_PRODUCTS);
});

test('/cv/ case studies include both MTS products', () => {
  const work = cv().slice(cv().indexOf('id="cv-work"'), cv().indexOf('id="cv-skills"'));
  for (const slug of ['mts-hub', 'wetlabs-app']) assert.match(work, new RegExp(`href="/work/${slug}/"`), slug);
});

test('/cv/ has a Before software section and an Interests line', () => {
  const page = cv();
  const before = page.match(/<section[^>]*aria-labelledby="cv-before"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(text(before), /Before software/);
  assert.match(text(before), /downhill skateboarder/i);
  const interests = page.match(/<section[^>]*aria-labelledby="cv-interests"[\s\S]*?<\/section>/)?.[0] ?? '';
  const items = [...interests.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1].trim());
  assert.deepEqual(items, HOBBIES);
});

test('home timeline runs from age 14 to MTS, and its MTS row names the two products', () => {
  const timeline = about().match(/<ol class="timeline[\s\S]*?<\/ol>/)?.[0] ?? '';
  const rows = [...timeline.matchAll(/<li[\s\S]*?<\/li>/g)].map((m) => text(m[0]));
  assert.ok(rows.length >= 6, `only ${rows.length} rows`);
  const order = [/Age 14.*Legion Airsoft/, /downhill skateboarder/i, /Skatedownhills/, /diploma/i, /Freelance/, /MTS/];
  let at = -1;
  for (const re of order) {
    const i = rows.findIndex((r, n) => n > at && re.test(r));
    assert.ok(i > at, `timeline row ${re} missing or out of order`);
    at = i;
  }
  const last = rows.at(-1);
  assert.match(last, /MTS Hub/);
  assert.match(last, /wetlabs\.app/);
  assert.doesNotMatch(timeline, NOT_PRODUCTS);
});
