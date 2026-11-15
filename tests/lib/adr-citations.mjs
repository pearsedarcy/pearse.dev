// Pure audit of ADR citations (issue #139). No file system access: callers pass the text of the
// source files and of the ADR files, plus a function that says whether a repo-relative path exists.
import { posix } from 'node:path';

/** The ADR the incident runbook must cite. */
export const RUNBOOK_FILE = 'automation/n8n/README.md';
export const RUNBOOK_ADR = '0013';

const BARE = /\bADR (\d{4})\b/g;
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const RANGE = /\b0001 to (\d{4})\b/g;

/** Every four-digit ADR number cited in `text`, as `ADR NNNN`, with duplicates removed. */
export function citedNumbers(text) {
  return [...new Set([...text.matchAll(BARE)].map((m) => m[1]))];
}

/** Links whose target is an ADR file: `{ text, target, path }`, with `path` relative to the repo root. */
export function adrLinks(text, file) {
  const out = [];
  for (const m of text.matchAll(LINK)) {
    const target = m[2].split('#')[0];
    if (!/(^|\/)docs\/adr\/[^/]+\.md$/.test(target)) continue;
    out.push({ text: m[1], target, path: posix.normalize(posix.join(posix.dirname(file), target)) });
  }
  return out;
}

/** True when the ADR text opens with a frontmatter block holding a non-empty `status` and `date`. */
export function frontmatterProblems(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return ['no frontmatter'];
  const problems = [];
  for (const key of ['status', 'date']) {
    if (!new RegExp(`^${key}:[ \\t]*\\S`, 'm').test(block[1])) problems.push(`frontmatter has no ${key}`);
  }
  return problems;
}

/**
 * @param {{ sources: Record<string,string>, adrs: Record<string,string>, exists: (path: string) => boolean }} input
 *   `sources` maps repo-relative file paths to text; `adrs` maps ADR file names (`0004-….md`) to text.
 * @returns {string[]} one message per problem; empty when everything is consistent
 */
export function audit({ sources, adrs, exists }) {
  const problems = [];
  const byNumber = new Map();
  for (const name of Object.keys(adrs)) {
    const n = /^(\d{4})-/.exec(name)?.[1];
    if (n) byNumber.set(n, [...(byNumber.get(n) ?? []), name]);
  }
  for (const [name, text] of Object.entries(adrs)) {
    for (const p of frontmatterProblems(text)) problems.push(`docs/adr/${name}: ${p}`);
  }
  const newest = [...byNumber.keys()].sort().at(-1);

  for (const [file, text] of Object.entries(sources)) {
    for (const n of citedNumbers(text)) {
      const found = byNumber.get(n) ?? [];
      if (found.length !== 1) problems.push(`${file}: ADR ${n} matches ${found.length} files in docs/adr/, expected 1`);
    }
    for (const link of adrLinks(text, file)) {
      if (!exists(link.path)) problems.push(`${file}: link target ${link.target} does not exist`);
      const label = /^ADR (\d{4})$/.exec(link.text)?.[1];
      if (label && !posix.basename(link.path).startsWith(`${label}-`)) {
        problems.push(`${file}: link text "${link.text}" points at ${posix.basename(link.path)}`);
      }
    }
    for (const m of text.matchAll(RANGE)) {
      if (newest && m[1] !== newest) problems.push(`${file}: says "0001 to ${m[1]}" but the newest ADR is ${newest}`);
    }
  }

  const runbook = sources[RUNBOOK_FILE];
  if (runbook === undefined) problems.push(`${RUNBOOK_FILE} was not read`);
  else if (!citedNumbers(runbook).includes(RUNBOOK_ADR)) problems.push(`${RUNBOOK_FILE} does not cite ADR ${RUNBOOK_ADR}`);
  return problems;
}
