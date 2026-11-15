---
status: accepted
date: 2026-11-15
---

# One build clock decides what is published

ADR 0003 publishes an article when its date has passed at build time. Until #283 (PR #343) "build time" was whatever each module read: `new Date()` in the post, visibility, series, feed, social, runway and Open Graph code, the footer year, and a separate `RUNWAY_NOW` override for the runway alone. A scheduled article was therefore first built, linked, fed and given a card by the unattended 04:23 UTC rebuild on its own publish day, and nothing could build the site as it would look on that day any earlier.

Decision: **every publishing decision reads one clock, `siteNow()` in `src/lib/clock.ts`, which is the real clock unless `SITE_NOW` is set.** `SITE_NOW` takes a `YYYY-MM-DD` date (UTC midnight, the frontmatter convention) or an ISO timestamp with `Z` or an offset. Empty counts as unset; any other value, a timestamp without a zone or a date that does not exist, throws an error that names `SITE_NOW`, so a typo fails the build instead of quietly using the real clock. Facts about the build itself (when the GitHub data was fetched) read `wallNow()`, the real clock, and never decide what is published. We rejected a per-module override (the old `RUNWAY_NOW`), because two modules could then disagree on what is live, and faking the system time, because it also moves the facts about the build and gives no test a way to tell a stray override from the real clock.

## Consequences

- `SITE_NOW=2026-12-01 npm test` builds and tests `dist/` as it will look on that date. A later plain build drops the article again, because `og:pages` empties `public/og/` and Astro empties `dist/`.
- A deploy never sets `SITE_NOW`: a build ahead of its date would publish early. `tests/clock.test.mjs` fails if any file under `.github/workflows/` mentions it, and bans any other clock read in the publishing code; the `og:pages` timing uses `performance.now()` so the ban needs no exceptions.
- An exported `SITE_NOW` in a local shell carries into every later `npm test` and `npm run build`. `og:pages` prints one `build clock: SITE_NOW=… (not for deploy)` line so it shows in the log. Unset it after use.
- A build with `SITE_NOW` set does not rewrite the GitHub snapshot or the avatar, so building ahead changes no tracked file.
- `RUNWAY_NOW` is gone; `npm run runway` reads the same clock.
- Slice 2 of the ahead build, a CI job that builds as of the next scheduled article's date, will narrow the workflow rule to that one job. Until then the rule has no exception.
