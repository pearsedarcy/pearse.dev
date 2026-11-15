// The one rule for "which inline-code tokens in a doc are repo paths" (#165, #282), shared by the
// checkers that keep docs/content-checklists.md and docs/operations.md from drifting away from the
// repo. Not a test file itself: `npm test` only runs tests/**/*.test.mjs. Pure: no files, no clock.

/** A token is a repo path when its first segment is one of these top-level dirs or root files. */
export const TOP_DIRS = ['src/', 'tests/', 'scripts/', 'docs/', 'public/', 'automation/', '.github/'];
export const ROOT_FILES = ['astro.config.mjs', 'package.json', 'lighthouserc.json', 'README.md', 'CHANGELOG.md', 'GLOSSARY.md'];

/** Text with fenced code blocks removed: only inline code is a citation. */
export const withoutFences = (text) => text.replace(/^```[\s\S]*?^```[^\n]*$/gm, '');

/** Every inline-code token in the text, outside fenced blocks. */
export const inlineTokens = (text) => [...withoutFences(text).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);

/**
 * The repo path a token cites, or null. A trailing argument is stripped, so
 * `automation/setup/credentials.sh renew-token` cites `automation/setup/credentials.sh`.
 * Placeholders, globs and ellipses anywhere in the token, `dist/` paths and URL paths (leading `/`)
 * are not citations; nor is a token whose first segment is not a known top-level dir or root file
 * (`npm run dns`, `$XDG_STATE_HOME/x`).
 */
export function repoPath(token) {
  if (/[<…*]/.test(token)) return null;
  const path = token.trim().split(/\s+/)[0];
  if (path.startsWith('dist/') || path.startsWith('/')) return null;
  return ROOT_FILES.includes(path) || TOP_DIRS.some((d) => path.startsWith(d)) ? path : null;
}

export const isRepoPath = (token) => repoPath(token) !== null;

/** The distinct repo paths a text cites in inline code, in first-seen order. */
export const citedPaths = (text) => [...new Set(inlineTokens(text).map(repoPath).filter(Boolean))];
