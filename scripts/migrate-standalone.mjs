#!/usr/bin/env node
// One-off migration: src/data/social-standalone.json -> src/content/social/<id>.md
// (one standalone post per file). Done: the JSON has been deleted and the collection
// is the source of truth. Kept as the record of how the files were generated.
// Run with an explicit input it still works (the tests use a fixture), but it overwrites outDir.
//
//   node scripts/migrate-standalone.mjs [input.json] [outDir]
//
// Field mapping: id -> lowercase filename, linkedin -> body, the rest -> frontmatter.
// `verify` and `chars` are derived counts and are dropped. `short` is derived from
// the first sentence of the copy plus the site URL when the JSON has none.
// Status `posted` (allowed by the JSON's own note) maps to `approved`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SITE } from '../src/lib/site.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_URL = SITE.url;
const SHORT_MAX = 280; // schema allows 300; 280 fits X with the URL
const STATUS = { draft: 'draft', approved: 'approved', posted: 'approved' };

/** First sentence of the first paragraph; punctuation inside [...] markers does not end it. */
export function firstSentence(text) {
  const para = text.trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ');
  let depth = 0;
  for (let i = 0; i < para.length; i++) {
    const c = para[i];
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && '.!?'.includes(c) && (i + 1 === para.length || para[i + 1] === ' ')) {
      return para.slice(0, i + 1);
    }
  }
  return para;
}

export function deriveShort(linkedin) {
  const tail = ` ${SITE_URL}`;
  let sentence = firstSentence(linkedin);
  const room = SHORT_MAX - tail.length;
  if (sentence.length > room) sentence = `${sentence.slice(0, room - 1).replace(/\s+\S*$/, '')}…`;
  return sentence + tail;
}

// JSON strings are valid YAML double-quoted scalars, so no YAML dependency is needed.
const q = (s) => JSON.stringify(String(s));

export function toMarkdown(post) {
  const status = STATUS[post.status ?? 'draft'];
  if (!status) throw new Error(`${post.id}: unknown status "${post.status}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) throw new Error(`${post.id}: date must be YYYY-MM-DD`);
  const lines = [
    '---',
    `title: ${q(post.title)}`,
    `date: ${post.date}`,
    `pillar: ${q(post.pillar)}`,
    `format: ${q(post.format)}`,
    `visual: ${q(post.visual ?? 'none')}`,
    `status: ${status}`,
    `short: ${q(post.short ?? deriveShort(post.linkedin))}`,
  ];
  if (post.note) lines.push(`note: ${q(post.note)}`);
  lines.push('---', '', post.linkedin.trim(), '');
  return lines.join('\n');
}

export function migrate(input, outDir) {
  const { posts } = JSON.parse(readFileSync(input, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const post of posts) {
    const file = join(outDir, `${post.id.toLowerCase()}.md`);
    writeFileSync(file, toMarkdown(post));
    written.push(file);
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = resolve(process.argv[2] ?? join(ROOT, 'src/data/social-standalone.json'));
  const outDir = resolve(process.argv[3] ?? join(ROOT, 'src/content/social'));
  if (!existsSync(input)) {
    console.error(`migrate-standalone: input file not found: ${input}. The migration is done; src/content/social/ is the source of truth.`);
    process.exit(1);
  }
  const written = migrate(input, outDir);
  console.log(`migrate-standalone: wrote ${written.length} file(s) to ${outDir}`);
}
