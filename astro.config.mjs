// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { writeFileSync } from 'node:fs';

// Case studies that were renamed or folded into another one (issue #39: MTS is two products).
// A static build turns each into a small HTML page with <meta http-equiv="refresh">, a canonical
// link and noindex, so URLs that are already indexed or shared keep working without JavaScript.
const MOVED_CASE_STUDIES = {
  ophthix: '/work/wetlabs-app/',
  'infrastructure-observability': '/work/wetlabs-app/#observability',
  wetpack: '/work/mts-hub/#packing',
  opthalyze: '/work/mts-hub/#feedback',
  'mts-atlas': '/work/mts-hub/#drafting',
  'mts-cortex': '/work/mts-hub/#knowledge',
};

const SITE = 'https://pearse.dev';

/** @param {string} s */
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Astro's static redirect page says "Redirecting from <code>/work/<old-slug>/</code> to …". An old
// slug may carry a name the site no longer uses (MTS is two products), so once the build is done each
// moved page is rewritten as the same redirect without the "from" text: meta refresh, noindex,
// canonical, a plain link, no JavaScript. Only the URL path itself still holds the old slug.
/** @type {import('astro').AstroIntegration} */
const quietRedirects = {
  name: 'quiet-redirects',
  hooks: {
    'astro:build:done': ({ dir }) => {
      for (const [slug, to] of Object.entries(MOVED_CASE_STUDIES)) {
        const rel = escapeHtml(to);
        const abs = escapeHtml(new URL(to, SITE).href);
        writeFileSync(
          new URL(`work/${slug}/index.html`, dir),
          `<!doctype html><title>Moved to ${rel}</title><meta http-equiv="refresh" content="0;url=${rel}">` +
            `<meta name="robots" content="noindex"><link rel="canonical" href="${abs}">` +
            `<body><a href="${rel}">This page has moved to <code>${rel}</code></a></body>\n`,
        );
      }
    },
  },
};

// https://astro.build/config
export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  redirects: Object.fromEntries(Object.entries(MOVED_CASE_STUDIES).map(([slug, to]) => [`/work/${slug}/`, to])),
  integrations: [sitemap(), quietRedirects],
  vite: {
    plugins: [tailwindcss()],
    // three.js is one intentionally lazy chunk (~130 KB gzipped); silence the 500 KB minified warning.
    build: { chunkSizeWarningLimit: 600 },
  },
  build: {
    inlineStylesheets: 'always',
  },
});
