#!/usr/bin/env node
/**
 * The publishing runway report (#128, GLOSSARY "Runway"). Reads the article, standalone and
 * project sources (drafts included, so not dist/social.json), runs buildRunway from
 * src/lib/runway.ts, prints the Markdown table, appends it to $GITHUB_STEP_SUMMARY when set, and
 * prints one `::warning title=Runway::` line per draft due within 7 days or overdue.
 *
 * Informational only: it gates nothing and exits 0. `now` is the clock, or RUNWAY_NOW (an ISO
 * date such as 2026-11-01) for deterministic runs. Output is ids, kinds, states, dates and
 * counts only. `npm run runway`; CI runs it in check.yml right after `npm ci`.
 */
import { appendFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { buildRunway, formatRunway, warningLine } from '../src/lib/runway.ts';
import { entries } from './content-entries.mjs';

const override = process.env.RUNWAY_NOW;
const now = override ? new Date(override) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error('runway: RUNWAY_NOW is not an ISO date.');
  process.exit(1);
}

const fileId = (file) => basename(file, extname(file));
const read = (dir, id) => entries(dir).map(({ file, data, body }) => ({ id: id(file, data), data, body }));

const runway = buildRunway(
  read('src/content/posts', (file, data) => data.slug ?? fileId(file)),
  read('src/content/social', fileId),
  read('src/content/projects', (file, data) => data.slug ?? fileId(file)),
  now,
);

const summary = formatRunway(runway);
process.stdout.write(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
for (const w of runway.warnings) console.log(warningLine(w));
