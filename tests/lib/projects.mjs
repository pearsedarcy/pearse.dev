// Case study frontmatter for the tests, read straight from the source files and classified
// with the same pure rule the pages use (src/lib/visibility.ts). Not a test file itself:
// `npm test` only runs tests/**/*.test.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { isVisibleProject } from '../../src/lib/visibility.ts';

const DIR = fileURLToPath(new URL('../../src/content/projects', import.meta.url));

/** Every case study's frontmatter, plus `file` (its file name) and `visible`. */
export function projects() {
  return readdirSync(DIR)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => {
      const data = parse(readFileSync(`${DIR}/${f}`, 'utf8').split(/^---$/m)[1]) ?? {};
      return { ...data, file: f, visible: isVisibleProject(data) };
    });
}

/** Slugs of client case studies still awaiting permission: absent from the whole build. */
export const pendingSlugs = () => projects().filter((p) => !p.visible).map((p) => p.slug);
