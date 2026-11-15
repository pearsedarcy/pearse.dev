#!/usr/bin/env node
/**
 * Turn lychee's JSON report into the body of the link-rot tracking issue (#164).
 * Usage: node scripts/link-rot-report.mjs <lychee.json> <body.md> [run-url]
 * Prints the number of failing URLs. Writes <body.md> only when that number is above 0.
 *
 * Only the failing URL and the dist-relative pages it appears on are kept: no status text, response
 * headers, bodies or redirect targets. Every URL listed is already public in dist/. Timeouts are not
 * reported: lychee keeps them in timeout_map, apart from errors, and a slow host is not a dead link.
 * Node built-ins only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `/abs/path/dist/a/index.html` or `dist/a/index.html` becomes `/a/index.html`. */
export function distPath(source) {
  const m = String(source).replace(/\\/g, '/').match(/(?:^|\/)dist(\/.*)$/);
  return m ? m[1] : String(source);
}

/** Failing URLs, each with its sorted pages, sorted by URL. lychee 0.15+ says error_map, older fail_map. */
export function failures(report) {
  const map = report?.error_map ?? report?.fail_map ?? {};
  const byUrl = new Map();
  for (const [source, entries] of Object.entries(map)) {
    for (const entry of entries ?? []) {
      if (typeof entry?.url !== 'string') continue;
      const pages = byUrl.get(entry.url) ?? new Set();
      pages.add(distPath(source));
      byUrl.set(entry.url, pages);
    }
  }
  return [...byUrl]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([url, pages]) => ({ url, pages: [...pages].sort() }));
}

const code = (s) => `\`${String(s).replace(/`/g, '')}\``;

export function issueBody(list, runUrl = '') {
  const lines = [
    'The weekly external link check (`.github/workflows/link-rot.yml`) found links in the built site that do not resolve.',
    'Fix or remove each one; the next run that passes closes this issue.',
    '',
    ...list.map(({ url, pages }) => `- ${code(url)} on ${pages.map(code).join(', ')}`),
  ];
  if (runUrl) lines.push('', `Run: ${runUrl}`);
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [reportPath, bodyPath, runUrl = ''] = process.argv.slice(2);
  if (!reportPath || !bodyPath) {
    console.error('Usage: node scripts/link-rot-report.mjs <lychee.json> <body.md> [run-url]');
    process.exit(2);
  }
  const list = failures(JSON.parse(readFileSync(reportPath, 'utf8')));
  if (list.length) writeFileSync(bodyPath, issueBody(list, runUrl));
  console.log(list.length);
}
