// Pure checker for docs/operations.md (#282): the one page listing everything that expires and
// stops publishing. No files, no clock: the caller passes every text, the parsed workflows and an
// `exists` callback, so fixtures can prove each rule fails. Not a test file itself.
import { posix } from 'node:path';
import { OLD_NAMES } from './old-names.mjs';
import { citedPaths } from './repo-paths.mjs';
import { parseFields } from './security-txt.mjs';

export const PAGE_PATH = 'docs/operations.md';
export const HEADER = ['Item', 'Lifetime / current expiry', 'What warns', 'Renewal', 'Last renewed'];

/** The cells of a Markdown table line, or null when the line is not a table row. */
const cells = (line) => {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
};
const isSeparator = (row) => row.length > 0 && row.every((c) => /^:?-{3,}:?$/.test(c));

/** Every table on the page: [{ header, rows }], each row a list of cells. */
export function tables(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const header = cells(lines[i]);
    const sep = cells(lines[i + 1]);
    if (!header || !sep || !isSeparator(sep)) continue;
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const row = cells(lines[j]);
      if (!row) break;
      rows.push(row);
    }
    found.push({ header, rows });
    i = j - 1;
  }
  return found;
}

/** The table whose header is exactly HEADER, or undefined. */
export const operationsTable = (text) =>
  tables(text).find((t) => t.header.length === HEADER.length && t.header.every((h, i) => h === HEADER[i]));

/** A parsed workflow's triggers: yaml 2.x parses `on` as a string key; a YAML 1.1 reading gives `true`. */
const triggers = (workflow) => workflow?.on ?? workflow?.[true];
export const isScheduled = (workflow) => {
  const on = triggers(workflow);
  return on !== null && typeof on === 'object' && !Array.isArray(on) && on.schedule != null;
};

/** Link targets of every inline Markdown link `[text](target)` in the text, anchors dropped. */
const linkTargets = (text) =>
  [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1].split('#')[0]).filter((t) => t && !/^[a-z][a-z0-9+.-]*:/i.test(t));

/**
 * Returns a list of error strings; empty when the page agrees with the repo.
 * - page: docs/operations.md text
 * - securityTxt: public/.well-known/security.txt text
 * - workflows: { '<repo path of the workflow file>': parsed YAML }
 * - readmes: { 'README.md': text, 'automation/README.md': text }
 * - exists: (repoPath) => boolean
 */
export function checkOperationsDoc({ page, securityTxt, workflows, readmes, exists }) {
  const errors = [];

  // 1. Header.
  const table = operationsTable(page);
  if (!table) errors.push(`${PAGE_PATH} has no table whose header is exactly: ${HEADER.join(' | ')}`);

  // 2. Expires. The row is looked for in the operations table, or in any table when the header is wrong.
  const expires = parseFields(securityTxt).Expires?.[0];
  const rows = table ? table.rows : tables(page).flatMap((t) => t.rows);
  const row = rows.find((r) => r[0]?.includes('security.txt'));
  if (!expires) errors.push('public/.well-known/security.txt has no Expires field');
  else if (!row) errors.push(`${PAGE_PATH} has no security.txt row`);
  else if (!row.join(' | ').includes(expires)) errors.push(`${PAGE_PATH} security.txt row does not contain the current Expires value ${expires}`);

  // 3. Scheduled workflows.
  for (const [file, workflow] of Object.entries(workflows)) {
    if (!isScheduled(workflow)) continue;
    const name = posix.basename(file);
    if (!page.includes(name)) errors.push(`${PAGE_PATH} does not name the scheduled workflow ${name}`);
  }

  // 4. Paths.
  for (const p of citedPaths(page)) {
    if (!exists(p)) errors.push(`${PAGE_PATH} cites \`${p}\`, which does not exist`);
  }

  // 5. README links, resolved from each README's own directory.
  for (const [file, text] of Object.entries(readmes)) {
    const dir = posix.dirname(file);
    const linked = linkTargets(text).some((t) => posix.normalize(posix.join(dir, t)) === PAGE_PATH);
    if (!linked) errors.push(`${file} has no Markdown link to ${PAGE_PATH}`);
  }

  // 6. Old names. The message does not repeat the name.
  if (OLD_NAMES.test(page)) errors.push(`${PAGE_PATH} names the retired product or a folded tool (OLD_NAMES, ADR 0006)`);

  return errors;
}
