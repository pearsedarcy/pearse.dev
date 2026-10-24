// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://pearse.dev',
  trailingSlash: 'always',
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
