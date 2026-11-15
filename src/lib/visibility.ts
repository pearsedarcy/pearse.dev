/**
 * The publish and visibility rules as pure functions of frontmatter data, with no
 * `astro:content` import, so build scripts (scripts/og-pages.mjs) apply exactly the
 * rules the pages do. `src/lib/posts.ts` and `src/lib/projects.ts` wrap these. Every `now`
 * defaults to the build clock (src/lib/clock.ts): `SITE_NOW` when set, otherwise the real clock.
 */
import { siteNow } from './clock.ts';

// Rendered on pearse.dev through src/lib/excerpt-sources.ts: an edit between these markers changes the site.
// excerpt:start visibility-rules
/** Published = not a draft and not dated in the future at build time. */
export function isPublishedPost(data: { draft?: boolean; pubDate: Date }, now = siteNow()): boolean {
  return !data.draft && data.pubDate.getTime() <= now.getTime();
}

/**
 * Visible = not a client case study awaiting permission. Only `category: client`
 * is gated by `clientPermission`, which defaults to 'pending' when absent.
 */
export function isVisibleProject(data: { category: string; clientPermission?: string }): boolean {
  return data.category !== 'client' || (data.clientPermission ?? 'pending') !== 'pending';
}
// excerpt:end visibility-rules

/**
 * Case study = visible (isVisibleProject) and not a smaller build. A `smallerBuild: true` entry
 * has no page, card number, Open Graph card or feed entry: it is one row in the /work/
 * "Smaller builds" list (ADR 0007). The flag defaults to false when absent.
 */
export function isCaseStudy(data: { category: string; clientPermission?: string; smallerBuild?: boolean }): boolean {
  return isVisibleProject(data) && data.smallerBuild !== true;
}

/**
 * The posts shown under "Writing about this project" on a case study: those whose
 * `project` is `slug` and that are published at `now` (isPublishedPost), newest first.
 * Generic over the entry, so the page passes collection entries and tests pass plain objects.
 */
export function relatedPosts<T extends { data: { draft?: boolean; pubDate: Date; project?: string } }>(
  posts: readonly T[],
  slug: string,
  now = siteNow(),
): T[] {
  return posts
    .filter((p) => p.data.project === slug && isPublishedPost(p.data, now))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

/** A case study with a page that declares a `repo`: what a home repo card links to (#275). */
export interface CaseStudyRepo {
  repo: string;
  slug: string;
  title: string;
}

/**
 * The `{ repo, slug, title }` of every case study with a page (isCaseStudy) that declares a
 * `repo`, in the given order. A smaller build or a client case study awaiting permission never
 * contributes one, so no repo card links a page that is not built. Takes plain frontmatter, so
 * `src/lib/projects.ts` passes collection data and tests pass fixtures.
 */
export function caseStudyRepos(
  entries: readonly { category: string; clientPermission?: string; smallerBuild?: boolean; repo?: string; slug: string; title: string }[],
): CaseStudyRepo[] {
  return entries.filter((d) => isCaseStudy(d) && !!d.repo).map((d) => ({ repo: d.repo!, slug: d.slug, title: d.title }));
}
