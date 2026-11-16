#!/usr/bin/env node
/**
 * The ahead date (#344, GLOSSARY "Build clock"). Reads the article sources (drafts included),
 * runs aheadDate from src/lib/ahead.ts at the build clock and prints one `ahead date: …` line
 * naming the date and, when an article set it, its slug. With $GITHUB_OUTPUT set it also writes
 * `date=<value>` there, which .github/workflows/ahead.yml passes to every later step as SITE_NOW.
 *
 * `now` is the build clock (src/lib/clock.ts): the real clock in CI, where nothing sets SITE_NOW
 * before this step; an invalid SITE_NOW exits 1. `npm run ahead`.
 */
import { appendFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { aheadDate, aheadLine } from '../src/lib/ahead.ts';
import { siteNow } from '../src/lib/clock.ts';
import { entries } from './content-entries.mjs';

let now;
try {
  now = siteNow();
} catch (err) {
  console.error(`ahead: ${err.message}`);
  process.exit(1);
}

const articles = entries('src/content/posts').map(({ file, data }) => ({ id: data.slug ?? basename(file, extname(file)), data }));
const ahead = aheadDate(articles, now);

console.log(aheadLine(ahead));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `date=${ahead.siteNow}\n`);
