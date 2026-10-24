import { getCollection } from 'astro:content';
import { absoluteUrl } from './site';
import { postPath } from './posts';
import { buildFeed, type FeedEntry } from './feed';

export type { FeedEntry } from './feed';

/** The social feed from the content collections; see buildFeed for the rules. */
export async function getFeedEntries(now = new Date()): Promise<FeedEntry[]> {
  const posts = await getCollection('posts');
  const social = await getCollection('social');
  return buildFeed(
    posts.map((p) => ({
      id: p.id,
      title: p.data.title,
      pubDate: p.data.pubDate,
      draft: p.data.draft,
      tags: p.data.tags,
      url: absoluteUrl(postPath(p)),
      social: p.data.social,
    })),
    social.map((p) => ({ id: p.id, ...p.data, body: p.body ?? '' })),
    now,
  );
}
