// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

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

// https://astro.build/config
export default defineConfig({
  site: 'https://pearse.dev',
  trailingSlash: 'always',
  redirects: Object.fromEntries(Object.entries(MOVED_CASE_STUDIES).map(([slug, to]) => [`/work/${slug}/`, to])),
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // three.js is one intentionally lazy chunk (~130 KB gzipped); silence the 500 KB minified warning.
    build: { chunkSizeWarningLimit: 600 },
  },
  build: {
    inlineStylesheets: 'always',
  },
});
