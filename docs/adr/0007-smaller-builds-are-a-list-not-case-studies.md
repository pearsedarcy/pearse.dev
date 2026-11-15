---
status: accepted
date: 2026-11-15
---

# Smaller builds are a list, not case studies

Four entries on /work/ had a numbered case-study page with a one-sentence body (14 to 29 words). A numbered page with one sentence on it makes the whole portfolio look thinner, so those entries became rows in a compact **Smaller builds** list at the end of /work/ (#169). An entry with a real story keeps its page. We rejected deleting the four entries, because their repos are worth a line, and rejected padding their bodies, because new copy written only to fill a page says nothing.

The content model gets one optional boolean, `smallerBuild`, which defaults to `false`. A smaller build keeps its file; its title, oneLiner, period, stack, repo and visibility drive the row. Its body, features and hooks stay in the file but are rendered nowhere.

## Consequences

- **One predicate.** `isCaseStudy(data)` in `src/lib/visibility.ts` means visible (`isVisibleProject`) and not a smaller build. `getVisibleProjects()` and `getWorkSequence()` use it, so case-study pages, the home grid and its "All N projects" count, /cv/, an article's linked project and the social feed all agree with no per-page filter. The feed builder and the Open Graph script call it directly, so no feed entry links a missing page and card numbers still match page numbers. `getSmallerBuilds()` returns the rows, sorted by `order`.
- **Numbering.** The /work/ category groups, the 01..N card numbers, the header count and its start year cover full case studies only. The Smaller builds section is numbered as the next group and its rows carry no number.
- **Rows.** A row is not a card and links no `/work/<slug>/` page. A public row links its `repo` as "Public repository"; a private row says "Private repository" and links nothing, as the case-study facts box does.
- **Redirects.** Each folded slug is an entry in `MOVED_CASE_STUDIES` (ADR 0006 pattern) pointing at `/work/#smaller-builds`: a static meta-refresh page with noindex and no JavaScript, kept out of the sitemap. ADR 0005 lists the stubs.
- **The 30-word rule of thumb.** A case study whose body would be under about 30 words is a candidate for `smallerBuild: true`. This is editorial guidance, not a build check: nothing fails on word count.
- `tests/smaller-builds.test.mjs`, `tests/visibility.test.mjs` and `tests/mts-products.test.mjs` hold the rules.
