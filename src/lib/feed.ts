// Pure social-feed logic. Its only import is the pure visibility module, so node:test
// can load it with type stripping (hence the explicit .ts extension).
import { isPublishedPost } from './visibility.ts';
// src/lib/social.ts feeds it from the content collections.

export interface Copy {
  linkedin: string;
  short: string;
}

export interface ArticleInput {
  id: string;
  title: string;
  pubDate: Date;
  draft: boolean;
  tags: string[];
  /** Absolute URL of the article page. */
  url: string;
  social: Copy;
}

export interface StandaloneInput {
  id: string;
  title: string;
  date: Date;
  pillar: string;
  format: string;
  visual: string;
  status: 'draft' | 'approved';
  short: string;
  /** Markdown body: the LinkedIn copy. */
  body: string;
}

interface BaseEntry {
  id: string;
  title: string;
  /** YYYY-MM-DD (UTC). */
  date: string;
  published: boolean;
  status: 'approved';
  social: Copy;
}

export interface ArticleEntry extends BaseEntry {
  kind: 'article';
  /** Legacy alias of `id`, kept for existing feed consumers. */
  slug: string;
  /** Legacy alias of `date`, kept for existing feed consumers. */
  pubDate: string;
  url: string;
  tags: string[];
}

export interface StandaloneEntry extends BaseEntry {
  kind: 'standalone';
  pillar: string;
  format: string;
  visual: string;
}

export type FeedEntry = ArticleEntry | StandaloneEntry;


const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The social feed: every non-draft article (published or scheduled) and every
 * approved standalone post, oldest first; on the same date articles come first.
 * Standalone posts have no page, so `published` is always true and they carry no `url`.
 * Throws if an approved standalone post's copy still has a verify marker.
 */
export function buildFeed(articles: ArticleInput[], standalone: StandaloneInput[], now = new Date()): FeedEntry[] {
  const a: ArticleEntry[] = articles
    .filter((p) => !p.draft)
    .map((p) => {
      const date = day(p.pubDate);
      return {
        kind: 'article',
        id: p.id,
        slug: p.id,
        title: p.title,
        date,
        pubDate: date,
        url: p.url,
        published: isPublishedPost(p, now),
        status: 'approved',
        tags: p.tags,
        social: { linkedin: p.social.linkedin.trim(), short: p.social.short.trim() },
      };
    });

  const s: StandaloneEntry[] = standalone
    .filter((p) => p.status === 'approved')
    .map((p) => {
      if (p.body.includes('[VERIFY')) {
        throw new Error(`Standalone post "${p.id}" is approved but its body still has a [VERIFY] marker; resolve it or set status: draft.`);
      }
      return {
        kind: 'standalone',
        id: p.id,
        title: p.title,
        date: day(p.date),
        pillar: p.pillar,
        format: p.format,
        visual: p.visual,
        published: true,
        status: 'approved',
        social: { linkedin: p.body.trim(), short: p.short.trim() },
      };
    });

  // Array.prototype.sort is stable: articles were added first, so they win date ties.
  return [...a, ...s].sort((x, y) => x.date.localeCompare(y.date));
}
