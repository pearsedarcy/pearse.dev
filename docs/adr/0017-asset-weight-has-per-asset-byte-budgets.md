---
status: accepted
date: 2026-11-15
---

# Asset weight has per-asset byte budgets in the test suite

Before #290 (PR #337) only Lighthouse guarded what a phone downloads. It scores a handful of URLs, its score moves from run to run, and the daily rebuild skips it (ADR 0003). A dependency bump or one careless import could add a hundred kilobytes of JavaScript and every other suite would stay green; the only byte budget in the suite was the CV PDF's.

Decision: **`tests/asset-budgets.test.mjs` gives each heavy asset its own byte budget over `dist/`, kept in one `BUDGETS` table with the measurement beside each row.** The three.js chunk, the GSAP motion chunk and each page's eager JavaScript are measured gzipped (zlib level 9, so the numbers are deterministic); each font family and each class of Open Graph card in raw bytes, since gzip does nothing to woff2 or PNG. `dist/` ships exactly three woff2 files, and three.js is never in a page's eager set or preloaded. A failure names the file, its size, the budget and the gap. We rejected one total-weight budget, because a saving in one place would hide a regression in another, and rejected a tighter Lighthouse budget, because a noisy score cannot name the file that grew.

## Consequences

- A three.js or GSAP minor release can fail `npm test` with no code change of ours. That is the point: someone decides whether the weight is worth it.
- To raise a budget, edit its row, put the new measurement in the comment beside it and say why in the pull request. A budget change and a shrink of the same asset do not share a pull request.
- The default Open Graph card has its own budget, the same 50 KB `tests/og.test.mjs` pins, because #278 re-encoded it far below the size the issue started from.
- The eager-JavaScript walk follows only static `import … from "./x.js"` edges, so the scene chunk listed for the dynamic import behind the scene gate (ADR 0010) is not counted against the first paint.
- CSS, HTML and images other than Open Graph cards have no budget.
