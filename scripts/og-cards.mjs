/**
 * Which Open Graph cards scripts/og-pages.mjs renders, and what each one says (#278). Pure: no
 * file is written, emptied or launched at import, so tests import it with fixture entries.
 *
 * `selectCards` takes its inputs injected (the build time and the post, project and now entries
 * as scripts/content-entries.mjs returns them); `cards` is the thin loader that reads the real
 * content directories. Three kinds of card:
 *
 * - `article`: every published article (src/lib/visibility.ts, the rules the pages use).
 * - `case`: every case study, numbered in /work/ order.
 * - `page`: the static pages in STATIC_PAGES (/cv/, /stack/, /now/), titled with the page's h1.
 *
 * Every slug must be URL-safe and unique across all three kinds, or this throws: an article whose
 * slug is `cv` would otherwise overwrite /og/cv.png.
 */
import { basename, extname } from 'node:path';
import { siteNow } from '../src/lib/clock.ts';
import { countNoun } from '../src/lib/count-label.ts';
import { CATEGORY_LABEL, SITE, SKILL_MAP, formatDate, formatMonthYear, readingTime } from '../src/lib/site.ts';
import { buildSkillGroups, countSkills } from '../src/lib/skill-map.ts';
import { isCaseStudy, isPublishedPost } from '../src/lib/visibility.ts';
import { caseNumber, compareWork } from '../src/lib/work-order.ts';
import { entries } from './content-entries.mjs';
import { ROLE_KICKER } from './og-shared.mjs';

/** Static pages with their own card. Each `title` is the page's h1 (tests/og.test.mjs compares). */
export const STATIC_PAGES = [
  { slug: 'cv', tag: 'CV', title: SITE.name },
  { slug: 'stack', tag: 'Stack', title: 'Stack' },
  { slug: 'now', tag: 'Now', title: 'What I am doing now' },
];

/** The static-page slugs, so tests derive the expected card set from them. */
export const STATIC_PAGE_SLUGS = STATIC_PAGES.map((p) => p.slug);

/** A frontmatter date (`YYYY-MM-DD` string from YAML, or a Date) as a Date; throws when it does not parse. */
function date(value, where) {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error(`${where}: bad date "${value}"`);
  return d;
}

/** The kicker of each static page's card: exactly the text that page shows. */
function pageKickers({ projects, nowEntry }) {
  // Same call as src/lib/skills.ts getSkillGroups(), on the raw frontmatter: buildSkillGroups
  // reads only fields the schema does not default or transform (sections and their stacks are
  // read with `?? []`), and tests/og.test.mjs pins the result against the built /stack/ eyebrow.
  const groups = buildSkillGroups(SKILL_MAP, projects.map((e) => e.data), (d) => isCaseStudy(d));
  const skills = countNoun(countSkills(groups), 'skill');
  return {
    cv: ROLE_KICKER,
    stack: `${skills.n} ${skills.noun}`,
    now: `Updated ${formatMonthYear(date(nowEntry.data.updated, `now/${nowEntry.file}: updated`))}`,
  };
}

/**
 * Every card to render, in render order: articles, case studies, then static pages.
 * `posts` and `projects` are `{ file, data, body }` entries; `nowEntry` is the one now entry.
 */
export function selectCards({ now = siteNow(), posts, projects, nowEntry }) {
  const out = [];
  for (const { file, data, body } of posts) {
    const pubDate = date(data.pubDate, `posts/${file}: pubDate`);
    if (!isPublishedPost({ draft: data.draft === true, pubDate }, now)) continue;
    out.push({
      slug: data.slug ?? basename(file, extname(file)),
      kind: 'article',
      title: String(data.title),
      tag: 'Writing',
      kicker: `${formatDate(pubDate)} / ${readingTime(body)} min read`,
    });
  }
  // Case studies in /work/ order, so a card's number matches the one on its page. Smaller builds
  // have no page, so they get no card and take no number (ADR 0007).
  const visible = projects.filter(({ data }) => isCaseStudy(data));
  for (const { file, data } of visible) if (!data.slug) throw new Error(`projects/${file}: no slug`);
  visible.sort((a, b) => compareWork(a.data, b.data));
  for (const [i, { data }] of visible.entries()) {
    out.push({
      slug: data.slug,
      kind: 'case',
      title: String(data.title),
      tag: caseNumber(i),
      kicker: `${CATEGORY_LABEL[data.category]} / ${data.period}`,
    });
  }
  const kickers = pageKickers({ projects, nowEntry });
  for (const { slug, tag, title } of STATIC_PAGES) out.push({ slug, kind: 'page', title, tag, kicker: kickers[slug] });

  const seen = new Map();
  for (const { slug, kind } of out) {
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`OG slug not URL-safe: ${slug}`);
    if (seen.has(slug)) throw new Error(`Two cards share the slug "${slug}" (${seen.get(slug)} and ${kind}); /og/${slug}.png would collide.`);
    seen.set(slug, kind);
  }
  return out;
}

/** The cards for the real content directories at `now` (the build clock by default). */
export function cards(now = siteNow()) {
  const [nowEntry, ...extra] = entries('src/content/now');
  if (!nowEntry || extra.length) throw new Error('src/content/now must hold exactly one entry');
  return selectCards({ now, posts: entries('src/content/posts'), projects: entries('src/content/projects'), nowEntry });
}
