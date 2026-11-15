// The CV frontmatter for the tests, read straight from src/content/cv/cv.md, and the Timeline
// rows built from it by the same pure function the home page uses (src/lib/timeline.ts).
// Not a test file itself: `npm test` only runs tests/**/*.test.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { timelineRows } from '../../src/lib/timeline.ts';

const FILE = fileURLToPath(new URL('../../src/content/cv/cv.md', import.meta.url));

/** cv.md's frontmatter as parsed YAML (schema defaults not applied). */
export function cvData() {
  return parse(readFileSync(FILE, 'utf8').split(/^---$/m)[1]) ?? {};
}

/** The home Timeline's rows, oldest first, as the build computes them. */
export const cvTimeline = () => timelineRows(cvData());
