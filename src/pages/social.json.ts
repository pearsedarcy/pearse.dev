/**
 * Machine-readable feed of every non-draft post, including scheduled ones,
 * oldest first. An n8n workflow reads this to schedule social posts.
 * Scheduled posts become live pages on their pubDate via the weekly rebuild.
 */
import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/site';
import { getAllPosts, postPath } from '../lib/posts';

export const GET: APIRoute = async () => {
  const posts = await getAllPosts();
  const body = posts.map((post) => ({
    slug: post.id,
    title: post.data.title,
    url: absoluteUrl(postPath(post)),
    pubDate: post.data.pubDate.toISOString().slice(0, 10),
    tags: post.data.tags,
    social: {
      linkedin: post.data.social.linkedin.trim(),
      short: post.data.social.short.trim(),
    },
  }));
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
