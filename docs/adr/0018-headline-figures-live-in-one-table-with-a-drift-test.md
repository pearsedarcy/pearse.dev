---
status: accepted
date: 2026-11-15
---

# Headline figures live in one table with a drift test

The site states the same counts about MTS Hub, wetlabs.app and pearse.dev (decision records, tests, test files, commits) on case studies, articles, standalone posts, the home page, the CV and the profile copy. Each was typed by hand where it appeared, so they disagreed: a count changed in one place and not another, and an ADR count on this site's own case study was already wrong. The MTS repositories are private, so no reader can check a number against its source, which makes a wrong one worse.

Decision: **every headline count is a figure in one table, `src/lib/figures.ts`, with the month it was measured and how, and `tests/figures.test.mjs` fails on any count in the copy that is neither a claim against a figure nor an ignored count with a reason** (#286, PR #341). The scan reads `src/content/`, the `.astro` pages and components and `docs/profile/`. A claim must agree with its figure under a written rule for each relation (a bare number is equal, "more than" is at least, "about" is within a tenth, and at least one) and must name the figure's measure, so a test count cannot be registered against an ADR figure. pearse.dev's own figures are not typed at all: its ADR figure is counted from `docs/adr/` when the tests run, and its case study computes its outcomes row and colophon at build from this repository's checkout (#287, PR #314). We rejected keeping hand-written counts with a review checklist, because the counts had already drifted under review, and rejected computing the MTS figures at build, because their repositories are private and the build must not reach them.

## Consequences

- Changing an MTS figure is one edit to the table plus the copy the test then names. A new count in the copy fails until it is claimed or ignored.
- MTS figures are counts only, and a figure's `method` names no runner, host, address or link (ADR 0005).
- pearse.dev figures are never summed into an MTS figure.
- Adding an ADR here changes the count on the pearse.dev case study with no copy edit, and no copy states that count by hand.
- The pearse.dev git figures need full history: `check.yml` checks out with `fetch-depth: 0`; a shallow clone such as the link-rot crawl leaves them out.
- Showing each figure's month and method beside an outcomes row is a later slice (#340).
