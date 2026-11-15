/**
 * The build clock (#283, GLOSSARY "Build clock"): the one place the site reads the time.
 *
 * - `siteNow()` is "now" for every publishing decision: which articles have pages, Open Graph
 *   cards, RSS and sitemap entries, series and prev/next links, the `/social.json` entries, the
 *   runway and the footer and RSS copyright year. It is the `SITE_NOW` environment variable when set, otherwise the
 *   real clock, so the site can be built and tested as it will look on a future date.
 * - `wallNow()` is always the real clock: for facts about the moment of the build, never for
 *   publishing decisions. Today its only user is the GitHub view model's `asOf`.
 *
 * `SITE_NOW` takes `YYYY-MM-DD` (UTC midnight, the convention isPublishedPost uses for
 * frontmatter dates) or a full ISO timestamp with `Z` or an offset. Empty counts as unset, because
 * Actions expressions often yield `''`. Anything else throws an error naming `SITE_NOW`, so a typo
 * fails the build instead of quietly using the real clock. It is read on every call, never cached,
 * so a test can set it in-process. A deploy never sets it (ADR 0003); tests/clock.test.mjs keeps it
 * out of every workflow and bans any other clock read in the publishing code.
 *
 * Plain TypeScript with no `astro:content` or Vite-only import: scripts/og-cards.mjs and
 * scripts/runway.mjs import it through Node's type stripping. Uses `process.env`, not
 * `import.meta.env`, which exposes only `PUBLIC_` variables and may be inlined at build time.
 */

// Typed here, not through @types/node: automation/n8n/tsconfig.json type-checks select.mjs, which
// reaches this file through src/lib/feed.ts, with `types: []`. Module-scoped, so it erases to nothing.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The instant `SITE_NOW` names, or `undefined` when it is unset or empty. Throws on any other
 * value, including a calendar date that does not exist (`2026-02-31`).
 */
export function siteNowOverride(): Date | undefined {
  const raw = process.env.SITE_NOW;
  if (raw === undefined || raw === '') return undefined;
  const at = new Date(raw);
  // Date rolls a day that does not exist over into the next month; the round trip catches it.
  const day = new Date(raw.slice(0, 10));
  const realDay = !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === raw.slice(0, 10);
  if (!(DAY.test(raw) || INSTANT.test(raw)) || Number.isNaN(at.getTime()) || !realDay) {
    throw new Error(
      `SITE_NOW=${JSON.stringify(raw)} is not a date: use YYYY-MM-DD (UTC midnight) or an ISO timestamp with Z or an offset, or unset SITE_NOW to use the real clock.`,
    );
  }
  return at;
}

/** "Now" for every publishing decision: `SITE_NOW` when set, otherwise the real clock. */
export function siteNow(): Date {
  return siteNowOverride() ?? new Date();
}

/**
 * The one line `og:pages`, the first step of `npm run build`, prints when `SITE_NOW` is set, so a
 * stray exported variable is visible in any build log; `undefined` when it is unset or empty.
 */
export function buildClockNotice(): string | undefined {
  const at = siteNowOverride();
  return at && `build clock: SITE_NOW=${at.toISOString()} (not for deploy)`;
}

/** The real clock, for facts about the moment of the build. Never for a publishing decision. */
export function wallNow(): Date {
  return new Date();
}
