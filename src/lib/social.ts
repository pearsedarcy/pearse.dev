import { getCollection, type CollectionEntry } from 'astro:content';
import { absoluteUrl } from './site';
import { getAllPosts, isPublished, postPath } from './posts';

export type StandalonePost = CollectionEntry<'social'>;

interface Copy {
  linkedin: string;
  short: string;
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

/** Every approved standalone post, including future-dated ones. Drafts never appear. */
export async function getApprovedStandalonePosts(): Promise<StandalonePost[]> {
  return getCollection('social', (p) => p.data.status === 'approved');
}

/**
 * The social feed: every non-draft article (published or scheduled) and every
 * approved standalone post, oldest first. Standalone posts have no page, so
 * `published` is always true and they carry no `url`.
 */
export async function getFeedEntries(now = new Date()): Promise<FeedEntry[]> {
  const articles: ArticleEntry[] = (await getAllPosts()).map((post) => {
    const date = day(post.data.pubDate);
    return {
      kind: 'article',
      id: post.id,
      slug: post.id,
      title: post.data.title,
      date,
      pubDate: date,
      url: absoluteUrl(postPath(post)),
      published: isPublished(post, now),
      status: 'approved',
      tags: post.data.tags,
      social: {
        linkedin: post.data.social.linkedin.trim(),
        short: post.data.social.short.trim(),
      },
    };
  });

  const standalone: StandaloneEntry[] = (await getApprovedStandalonePosts()).map((post) => ({
    kind: 'standalone',
    id: post.id,
    title: post.data.title,
    date: day(post.data.date),
    pillar: post.data.pillar,
    format: post.data.format,
    visual: post.data.visual,
    published: true,
    status: 'approved',
    social: {
      linkedin: (post.body ?? '').trim(),
      short: post.data.short.trim(),
    },
  }));

  // Stable sort: on the same date articles come before standalone posts.
  return [...articles, ...standalone].sort((a, b) => a.date.localeCompare(b.date));
}
