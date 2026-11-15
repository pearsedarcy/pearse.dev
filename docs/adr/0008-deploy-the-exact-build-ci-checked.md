---
status: accepted
date: 2026-11-01
---

# Deploy the exact build that CI checked

Until #150 (PR #212) the `check` job built `dist/` and ran the link crawl, Lighthouse, the tests and the confidentiality gate against it, and then the deploy workflow's own `build` job rebuilt the site from scratch with `withastro/action`, its own GitHub fetch and its own clock, and uploaded that build. The site that went live had never been crawled, tested or gated, so ADR 0005's "runs in CI against the built site" was false for the build that shipped. The `check` job also built twice (once for the checks, once in `pretest`).

Decision: **build once, check that build, and publish that build.** `check.yml` builds `dist/` in one Build step, hashes it, runs every check against it, recomputes the hash after the gate (`Verify dist unchanged` fails on any difference) and, outside pull requests, uploads `dist/` as the run's `github-pages` artifact. `deploy.yml` builds nothing: its `deploy` job needs `check` and publishes that artifact with `actions/deploy-pages`. We rejected keeping a separate deploy build, because a second build can differ from the checked one (a later GitHub fetch, a later clock for publish-by-date), and rejected re-running the checks inside the deploy job, which would still mean two builds and two fetches per deploy.

## Consequences

- CI runs the suites with `npm run test:ci`, the same command as `npm test` without its `pretest` build. Under `CI`, `tests/og.test.mjs` throws on a stale or missing `dist/` instead of rebuilding. Local `npm test` still builds first.
- Any check that writes into `dist/` fails the run at `Verify dist unchanged`. A new check goes above that step.
- A deploy makes one build and one GitHub fetch, down from three of each.
- `deploy` runs only on `refs/heads/master`, because the `github-pages` environment accepts only `master`. A dispatch on another branch runs `check` and the upload, then skips `deploy`. The daily rebuild (ADR 0003) takes the same path.
- "Gated" means the gate step ran on the published build. Whether a missing pattern list fails that step is a separate decision (#98).
- `tests/ci-workflow.test.mjs` holds the job layout, the single Build step, the hash-and-verify pair and the upload condition.
