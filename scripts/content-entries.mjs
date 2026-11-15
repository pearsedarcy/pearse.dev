/**
 * Frontmatter and body of every Markdown entry in a content collection, read straight from the
 * source files with the `yaml` devDependency (no `astro:content`), so build scripts see drafts
 * too. Dates stay the `YYYY-MM-DD` strings YAML gives. Shared by scripts/og-pages.mjs and
 * scripts/runway.mjs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export const root = resolve(import.meta.dirname, '..');

/** `{ file, data, body }` for every .md/.mdx file in `dir` (relative to the repository root). */
export function entries(dir) {
  return readdirSync(resolve(root, dir))
    .filter((f) => /\.mdx?$/.test(f))
    .map((file) => {
      const src = readFileSync(resolve(root, dir, file), 'utf8');
      const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
      if (!m) throw new Error(`${dir}/${file}: no frontmatter`);
      return { file, data: parse(m[1]) ?? {}, body: m[2] };
    });
}
