/**
 * The social feed: every non-draft article (including scheduled ones) and every
 * approved standalone post, oldest first. An n8n workflow reads this to schedule
 * social posts. Scheduled articles become live pages on their pubDate via the
 * daily rebuild; `published` is false until the page exists, so a scheduler must
 * not link early. Standalone posts have no page and no `url`.
 */
import type { APIRoute } from 'astro';
import { getFeedEntries } from '../lib/social';

export const GET: APIRoute = async () => {
  const body = await getFeedEntries();
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
