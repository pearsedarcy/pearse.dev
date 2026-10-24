// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, readFileSync } from 'node:fs';

// Hidden case studies (client work without permission) must not reach the sitemap.
// Frontmatter is read directly because astro:content is unavailable in the config.
const hiddenWork = readdirSync('./src/content/projects')
  .filter((f) => /\.mdx?$/.test(f))
  .map((f) => readFileSync(`./src/content/projects/${f}`, 'utf8').split(/^---\s*$/m)[1] ?? '')
  .filter((fm) => /^category:\s*client\s*$/m.test(fm) && !/^clientPermission:\s*(granted|anonymised)\s*$/m.test(fm))
  .map((fm) => fm.match(/^slug:\s*(\S+)/m)?.[1])
  .filter(Boolean)
  .map((slug) => `https://pearse.dev/work/${slug}/`);

// https://astro.build/config
export default defineConfig({
  site: 'https://pearse.dev',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !hiddenWork.includes(page) })],
  vite: {
    plugins: [tailwindcss()],
    // three.js is one intentionally lazy chunk (~130 KB gzipped); silence the 500 KB minified warning.
    build: { chunkSizeWarningLimit: 600 },
  },
  build: {
    inlineStylesheets: 'always',
  },
});
