// Case study frontmatter for the tests, read straight from the source files and classified
// with the same pure rule the pages use (src/lib/visibility.ts). Not a test file itself:
// `npm test` only runs tests/**/*.test.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { isCaseStudy, isVisibleProject } from '../../src/lib/visibility.ts';

const DIR = fileURLToPath(new URL('../../src/content/projects', import.meta.url));

/**
 * Every case study's frontmatter, plus `file` (its file name), `visible` (not a pending client)
 * and `caseStudy` (visible and not a smaller build: it has a page, a number and an OG card).
 */
export function projects() {
  return readdirSync(DIR)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => {
      const data = parse(readFileSync(`${DIR}/${f}`, 'utf8').split(/^---$/m)[1]) ?? {};
      return { ...data, file: f, visible: isVisibleProject(data), caseStudy: isCaseStudy(data) };
    });
}

/** Slugs of client case studies still awaiting permission: absent from the whole build. */
export const pendingSlugs = () => projects().filter((p) => !p.visible).map((p) => p.slug);

/**
 * Slugs of visible smaller builds (`smallerBuild: true`), sorted by `order`: rows in the /work/
 * "Smaller builds" list with no page, number or OG card. Not pending: their old URLs are
 * redirect pages and their repos are linked (ADR 0007).
 */
export const smallerBuildSlugs = () =>
  projects()
    .filter((p) => p.visible && !p.caseStudy)
    .sort((a, b) => a.order - b.order)
    .map((p) => p.slug);
