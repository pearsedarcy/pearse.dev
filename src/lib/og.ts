import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './site';

export interface PageOg {
  image?: string;
  imageAlt?: string;
}

/**
 * The page's own Open Graph card, rendered by scripts/og-pages.mjs (the `prebuild`
 * step) to public/og/<slug>.png. When the card was not rendered (no Chrome, or
 * `astro dev` without a build) both fields are undefined and Base keeps the default.
 * Paths resolve from the project root, where `astro build` runs.
 */
export function pageOg(slug: string, title: string): PageOg {
  if (!existsSync(join(process.cwd(), 'public', 'og', `${slug}.png`))) return {};
  return { image: `/og/${slug}.png`, imageAlt: `${title}, ${SITE.name}, pearse.dev` };
}
