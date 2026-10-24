import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

/** Published = not a draft and not dated in the future at build time. */
export function isPublished(post: Post, now = new Date()): boolean {
  return !post.data.draft && post.data.pubDate.getTime() <= now.getTime();
}

export async function getPublishedPosts(): Promise<Post[]> {
  const now = new Date();
  const posts = await getCollection('posts', (p) => isPublished(p, now));
  return posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

/** Every non-draft post, including scheduled ones, oldest first. For the social feed. */
export async function getAllPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', (p) => !p.data.draft);
  return posts.sort((a, b) => a.data.pubDate.getTime() - b.data.pubDate.getTime());
}

export function postPath(post: Post): string {
  return `/writing/${post.id}/`;
}
