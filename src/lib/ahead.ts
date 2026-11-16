// The ahead date (#344, GLOSSARY "Build clock"): the build clock the ahead build
// (.github/workflows/ahead.yml) sets `SITE_NOW` to, so CI builds and tests dist/ as of the next
// scheduled article's date days before the unattended 04:23 UTC rebuild publishes it.
// Pure, with explicit .ts imports like runway.ts, so node:test and scripts/ahead-date.mjs load it.
// Only articles drive it: approved standalone posts and visible case studies are already built
// and fed whatever their date. Output is a date and a slug only, never a title or copy.
import { siteNow } from './clock.ts';
import { isPublishedPost } from './visibility.ts';

/** Days ahead of today the build runs when no article is scheduled. */
export const FALLBACK_DAYS = 14;

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Article frontmatter as parsed (YAML gives dates as `YYYY-MM-DD` strings), keyed by slug. */
export interface AheadInput {
  id: string;
  data: Readonly<Record<string, unknown>>;
}

export interface Ahead {
  /** The `SITE_NOW` value: `YYYY-MM-DD`, or a full ISO instant when the pubDate has a time of day. */
  siteNow: string;
  /** The slug of the article that set it, or `undefined` for the today + FALLBACK_DAYS fallback. */
  slug?: string;
}

function toDate(value: unknown, what: string): Date {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error(`${what}: no valid date`);
  return d;
}

/**
 * The ahead date at `now`: the pubDate of the earliest non-draft article not yet published at
 * `now` (isPublishedPost), ties broken by slug; when there is none, UTC midnight of today plus
 * FALLBACK_DAYS. A pubDate at UTC midnight (the frontmatter convention) gives `YYYY-MM-DD`; one with
 * a time of day gives that instant, so the article is always published in the ahead build.
 */
export function aheadDate(articles: readonly AheadInput[], now = siteNow()): Ahead {
  let next: { id: string; pubDate: Date } | undefined;
  for (const { id, data } of articles) {
    if (data.draft === true) continue;
    const pubDate = toDate(data.pubDate, `article "${id}" pubDate`);
    if (isPublishedPost({ draft: false, pubDate }, now)) continue;
    const t = pubDate.getTime();
    if (!next || t < next.pubDate.getTime() || (t === next.pubDate.getTime() && id < next.id)) next = { id, pubDate };
  }
  if (next) {
    const iso = next.pubDate.toISOString();
    return { siteNow: iso.endsWith('T00:00:00.000Z') ? day(next.pubDate) : iso, slug: next.id };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { siteNow: day(new Date(today + FALLBACK_DAYS * DAY_MS)) };
}

/** The one log line: the date and, when an article set it, its slug. Never a title. */
export function aheadLine(a: Ahead): string {
  return a.slug
    ? `ahead date: ${a.siteNow} (next scheduled article: ${a.slug})`
    : `ahead date: ${a.siteNow} (no scheduled article: today + ${FALLBACK_DAYS} days)`;
}
