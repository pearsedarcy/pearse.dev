/**
 * Source excerpts on case studies (#152): short regions of this repository's own code, read from
 * the files at build time so the page always shows what ships. A region sits between an
 * `excerpt:start <id>` comment line and an `excerpt:end <id>` comment line in its source file.
 *
 * Pure and import-free on purpose: `src/content.config.ts` needs `EXCERPT_IDS` without pulling in the
 * raw-source registry that reads the files, and the tests import this file in plain Node.
 */

/** Every excerpt id, in page order. Non-empty `as const` tuple so `z.enum` accepts it. */
export const EXCERPT_IDS = ['visibility-rules', 'gate-reporting', 'diagram-checks'] as const;
export type ExcerptId = (typeof EXCERPT_IDS)[number];

/** The longest region allowed, in lines. An excerpt is a few lines of source, not a file. */
export const EXCERPT_MAX_LINES = 30;

export interface ExcerptMeta {
  /** Repository-relative path of the source file. */
  path: string;
  /** Shiki language id. */
  lang: 'ts' | 'js';
  /** One sentence shown above the code. */
  caption: string;
}

export const EXCERPTS: Record<ExcerptId, ExcerptMeta> = {
  'visibility-rules': {
    path: 'src/lib/visibility.ts',
    lang: 'ts',
    caption: 'The publish and visibility rules are pure functions of frontmatter, so pages, feeds and build scripts all apply the same ones.',
  },
  'gate-reporting': {
    path: 'scripts/gate.mjs',
    lang: 'js',
    caption: 'The confidentiality gate reports a hit as the file and the pattern number only, so a CI log never repeats the text it caught.',
  },
  'diagram-checks': {
    path: 'src/components/diagrams/layout.ts',
    lang: 'ts',
    caption: 'Architecture diagrams are checked at build time: a label wider than its box, or a box too short for its text, fails the build instead of shipping clipped.',
  },
};

export interface Excerpt {
  /** The region with its common leading indentation removed. */
  code: string;
  /** 1-based line number, in the committed file, of the first line between the markers. */
  startLine: number;
  /** 1-based line number, in the committed file, of the last line between the markers. */
  endLine: number;
}

const MARKER = /\bexcerpt:(start|end)\s+([a-z0-9-]+)/;

/**
 * The region `id` of `source`, the raw text of the file at `path`. Throws, naming the id and path,
 * when a marker is missing or appears twice, the end comes before the start, the region is empty
 * or blank, or it is longer than EXCERPT_MAX_LINES.
 */
export function extractExcerpt(source: string, id: ExcerptId, path: string = EXCERPTS[id]?.path ?? '(unknown path)'): Excerpt {
  const fail = (why: string): never => {
    throw new Error(`excerpt "${id}" in ${path}: ${why}`);
  };
  const lines = source.split(/\r?\n/);
  const starts: number[] = [];
  const ends: number[] = [];
  lines.forEach((line, i) => {
    const m = MARKER.exec(line);
    if (!m || m[2] !== id) return;
    (m[1] === 'start' ? starts : ends).push(i);
  });
  if (starts.length === 0) fail('no excerpt:start marker');
  if (ends.length === 0) fail('no excerpt:end marker');
  if (starts.length > 1) fail(`excerpt:start appears ${starts.length} times`);
  if (ends.length > 1) fail(`excerpt:end appears ${ends.length} times`);
  const [start] = starts;
  const [end] = ends;
  if (end < start) fail('excerpt:end comes before excerpt:start');
  const region = lines.slice(start + 1, end);
  if (region.every((l) => l.trim() === '')) fail('the region is empty');
  if (region.length > EXCERPT_MAX_LINES) {
    fail(`the region is ${region.length} lines, over the ${EXCERPT_MAX_LINES}-line cap; shorten it, do not raise the cap`);
  }
  const indents = region.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = Math.min(...indents);
  return {
    code: region.map((l) => (l.trim() === '' ? '' : l.slice(cut))).join('\n'),
    startLine: start + 2,
    endLine: end,
  };
}

/**
 * The GitHub link to an excerpt's exact lines. `sha` is the commit being built (GITHUB_SHA in
 * Actions); anything that is not a full 40-hex commit id falls back to `master` (local builds).
 */
export function excerptHref(repo: string, path: string, startLine: number, endLine: number, sha?: string): string {
  const ref = sha && /^[0-9a-f]{40}$/.test(sha) ? sha : 'master';
  return `${repo}/blob/${ref}/${path}#L${startLine}-L${endLine}`;
}
