---
status: accepted
date: 2026-10-24
---

# Publish by publication date at build time, with a daily rebuild

An article is published when it is not a draft and its publication date (UTC) has passed at build time. A scheduled workflow rebuilds and redeploys the site every morning so a scheduled article goes live on its date without a commit. We rejected deploying on a per-article timer because GitHub Pages has no such thing, and rejected client-side date checks because the page would still exist and be indexable.

## Consequences

- "Build time" means the build clock (`src/lib/clock.ts`): `SITE_NOW` when it is set, otherwise the real clock. A deploy never sets it; `tests/clock.test.mjs` fails if any workflow other than the ahead build mentions it.
- The social feed lists scheduled articles before their page exists, with a `published` flag, so the scheduler must never post a link whose flag is false.
- A rebuild at 04:23 UTC means an article dated today is live from roughly then, not from midnight.
- GitHub disables scheduled workflows after 60 days with no repository activity, which would stop the daily rebuild silently. `.github/workflows/keepalive.yml` re-enables the deploy workflow weekly, with no commit. That works only if the enable call resets GitHub's inactivity counter, which GitHub does not document. The fallback is a push to `master` at least every 60 days.
- The scheduled rebuild publishes content, not new code, so it skips the Lighthouse budget (and its report upload); everything else in `check.yml` still runs, and pull requests, pushes to `master` and manual dispatches still run Lighthouse. A performance score just under budget on one morning therefore cannot block that day's article. The cost: a date-gated article that goes live on schedule was absent from the PR-time `dist/` and `lighthouserc.json` lists URLs by hand, so the rebuild does not check performance of the pages it newly publishes. That stays with the PR that bumps the article URL, or a manual dispatch.
- The rebuild is the first build of a scheduled article's page, so a defect that only shows once the article is published used to surface on its publish day, unattended. The ahead build (#344, `.github/workflows/ahead.yml`) closes that gap: on every pull request, every push to `master` and daily at 05:41 UTC, after the rebuild, it builds and runs check, `test:ci`, the link crawl, a11y and the gate with `SITE_NOW` set to the next scheduled article's date (today + 14 days when none is scheduled), and deploys and uploads nothing. The keepalive workflow does not cover it: a lapsed ahead job loses no publish.
