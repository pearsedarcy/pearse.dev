import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE, copyrightLine, copyrightYear } from '../lib/site';
import { getPublishedPosts, postPath } from '../lib/posts';

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET(context: APIContext) {
  const posts = await getPublishedPosts();
  return rss({
    title: `${SITE.name} — Writing`,
    description: SITE.description,
    site: context.site ?? SITE.url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: postPath(post),
      categories: post.data.tags,
    })),
    // The licence wording is escaped so a future name with `&` or `<` cannot break the feed.
    customData: `<language>en-gb</language><copyright>${escapeXml(copyrightLine(copyrightYear()))}</copyright>`,
  });
}
