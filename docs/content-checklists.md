# Content checklists

Four checklists for the content changes that touch more than one file: add a case study, add an article, add a standalone post, rename or fold a case study. A missed step often fails without an error, so each step names the file, what to set, and what catches a miss. Where nothing catches it, the step says **Not enforced**.

This page does not define fields. For frontmatter, follow the README sections ([Add a project](../README.md#add-a-project), [Diagrams](../README.md#diagrams), [Add a post](../README.md#add-a-post), [Add a standalone post](../README.md#add-a-standalone-post)) and the schemas in `src/content.config.ts`. Where this page says "the schema", the build fails on a miss.

`tests/content-checklists.test.mjs` keeps this page honest: every repo path cited in backticks must exist, and every registry named here must still be defined where it is said to be. When a registry is removed or renamed, edit its row in the REGISTRIES table in that test and the matching step here.

Confidentiality applies to every checklist (ADR 0005, ADR 0006). Copy names no customer, congress or society, no owner, no hostname or address, no credential, no price or business figure, and no private repository link. The gate (`npm run gate`) checks `dist/`, `src/` and `docs/` against a denylist kept outside the repo; locally it checks nothing until `.confidential-patterns` exists (README Checks). Examples on this page use placeholders only: `<slug>`, `<old-slug>`, `<id>`, `<Name>`.

<a id="add-a-case-study"></a>
## 1. Add a case study

1. `src/content/projects/<slug>.md`: create it with the fields in README "Add a project". The file name and `slug` give the URL `/work/<slug>/`. Enforced by: the schema in `src/content.config.ts` (a missing or mistyped field fails the build).
2. The same file, `order`: an integer no other case study uses. Enforced by: `tests/work-order.test.mjs` (unique `order`, card numbers follow it).
3. The same file, `period`: `Mon – Mon YYYY` with a spaced en dash (for example a month, a spaced en dash, a month and a year), or `Mon YYYY – Present` for ongoing work. A hyphen in its place breaks the CV's start-of-period split. Partially enforced by: the schema (only the "Present" form), `periodBounds` in `src/lib/skill-map.ts` (an unparseable period on a case study with a page fails the build through `/stack/`) and `tests/ongoing-periods.test.mjs`. A smaller build is never parsed, and `tests/cv.test.mjs` only checks that the CV output holds no en dash, so a wrong split in `src/pages/cv.astro` is not proven.
4. The same file, `clientPermission` (client case studies only): set it explicitly to `granted` or `anonymised` once written permission exists, or to `pending` while it does not. Not enforced: it defaults to `pending`, which fails closed, so a forgotten value hides the case study instead of failing a check. `tests/visibility.test.mjs` enforces what each value does, not that one is set.
5. The same file, `quote` (client case studies only): add it only once the client has granted the quote in writing, with `text` the granted words exactly (one paragraph, at most 240 characters, never edited or paraphrased), `attribution` as `<Role>, <organisation type or domain>` (exactly `Client, website project` on an `anonymised` case study) and `permission: granted`. Never commit an entry for a declined, pending or unanswered quote: there is no `declined` value, and a quote with no entry looks the same whichever it was. Enforced by: the schema (`validateQuote` in `src/lib/quotes.ts`: non-client case study, length, line break, verify marker, attribution form and the anonymised wording, whatever the permission), `tests/quotes.test.mjs` (every committed quote is `permission: granted`) and `tests/visibility.test.mjs` (only granted quotes on visible case studies render), and `tests/cv.test.mjs` (the /cv/ PDF stays at two pages: the two shown quotes share page two's spare room, so two long ones can push it to a third). Not enforced: no personal name in `attribution` or `text`; nothing can detect one, so that is a human check in review.
6. The same file, `repo`, `live` and `visibility`: `repo` only for a public repository; a private one shows "Private repository" and never links. A `repo` that matches a home GitHub repository card (case-insensitive, ignoring a trailing slash or `.git`) now auto-links that card to `/work/<slug>/`; a smaller build or a pending client never does. Enforced by: `tests/github.test.mjs` (the card's `/work/` links are exactly the matching case studies). A repository card's "Learning · <year>" chip is a separate hand-kept allowlist, `LEARNING_REPOS` in `src/lib/github.ts`: add a key only for a shown repository whose own description calls it a learning project, with the year its work started (GitHub `created_at` unless known to be earlier), never the case study's start year. Not enforced as a rule: only the gate's denylist and review catch a link that should not be there.
7. The same file, copy and any `[VERIFY: …]` marker: resolve every marker before the case study is visible. Enforced by: the build (`src/lib/verify-marker.ts`, called from `buildFeed` in `src/lib/feed.ts`), `tests/verify-marker.test.mjs` and its `dist/` backstop.
8. For a diagram only: `src/components/diagrams/<Name>.astro`, the component. Enforced by: the import in `src/components/diagrams/index.ts` (a missing file fails the build).
9. For a diagram only: add `<Name>` to `DIAGRAM_NAMES` in `src/lib/diagrams.ts`. Enforced by: the `diagram:` enum in the schema (a case study naming an unlisted diagram fails the build) and, for a name missing from `DIAGRAMS`, `npm run check` (step 10).
10. For a diagram only: add `<Name>` to `DIAGRAMS` in `src/components/diagrams/index.ts`. Enforced by: `npm run check`, in both directions, because the object is typed `Record<DiagramName, …>`: a name in `DIAGRAM_NAMES` and missing here is a missing property, and a name here and missing from `DIAGRAM_NAMES` is an unknown key. Only `npm run check` sees this, not `npm run build` or `npm test`, because the schema enum reads `DIAGRAM_NAMES` alone.
11. For a diagram only: `tests/diagrams.test.mjs`, the per-case-study list of expected diagram ids. Add the slug and its ids. Not enforced: a case study missing from the list is rendered but never checked for hostnames, addresses, path-like text or repo slugs in its diagram text (the gate still scans the built page).
12. The commissioned or client repository: add nothing. The home GitHub section is an allowlist, so a repository shows only when `FEATURED_REPOS` or `SHOWN_REPOS` in `src/lib/github.ts` names it. Never add a client repository. Enforced by: `tests/github.test.mjs` for the listing rule; not enforced for a client name added to those lists by hand.
13. `lighthouserc.json`: a new page needs no entry. If the page replaces one of the audited URLs, change that URL. Enforced by: the CI `lhci` step only (`npm test` checks just that the CV and the source-excerpt case study stay in the list, in `tests/mailto.test.mjs` and `tests/excerpts.test.mjs`).
14. A tool that grew up inside MTS Hub or wetlabs.app: do not add a case study. Add a `sections` entry to that product instead (ADR 0006). Enforced by: `tests/mts-products.test.mjs` (exactly two MTS case studies, no retired names).
15. `CHANGELOG.md`: one line under Unreleased. Not enforced.

**Verify**

```sh
npm run check
npm test
npm run gate
npm run links
ls dist/work/<slug>/index.html
grep -l 'class="case-diagram"' dist/work/<slug>/index.html
```

`npm test` rebuilds `dist/` first. The `ls` fails for a client case study still `pending`, which is the intended result. Run the `grep` only when the case study has a diagram.

<a id="add-an-article"></a>
## 2. Add an article

1. `src/content/posts/<slug>.md`: create it with the fields in README "Add a post". The file name gives the URL `/writing/<slug>/`. Enforced by: the posts schema in `src/content.config.ts`.
2. The same file, `description`: length limit: see the posts schema in `src/content.config.ts`. Enforced by: that schema (`src/content.config.ts`), at build time.
3. The same file, `pubDate` and `draft`: a `draft: true` or future-dated article stays off the pages and RSS until its date; the daily rebuild publishes it. Enforced by: `tests/social-feed.test.mjs` (draft exclusion and ordering in `/social.json`).
4. The same file, `tags`: one to three tags from the closed list in `src/lib/tags.ts`. A new tag goes there with its pillar and must be carried by at least two posts. Enforced by: the schema (unknown tag) and `tests/post-tags.test.mjs` (count, carriers).
5. The same file, `project:` (optional): an existing case study slug. Enforced by: `tests/related-posts.test.mjs` (every `project:` must name a file in `src/content/projects/`). The page build alone drops an unknown link without an error, so a failing `npm test` is the only signal.
6. The same file, `series` and `seriesOrder` (optional): both or neither; the order is unique within the series. Enforced by: the schema and the series check at build time, `tests/series.test.mjs`.
7. The same file, `social.linkedin` and `social.short`: required; the social copy lives with the article (ADR 0002). Enforced by: the schema (required, `short` at most 300 characters including the URL) and `tests/post-short-cap.test.mjs`.
8. The same file, any `[VERIFY: …]` marker in the body or any frontmatter field: resolve it or set `draft: true`. Enforced by: the build for every non-draft article, past-dated or scheduled (`src/lib/verify-marker.ts`), and the `dist/` backstop in `tests/verify-marker.test.mjs`.
9. `lighthouserc.json`: only when this article replaces the audited article URL, change that URL. Enforced by: the CI `lhci` step only; nothing in `npm test` reads the URL list for an article.
10. Links inside the body to pages on the site: use the real page, never an old redirected slug. Enforced by: `npm run links` (a missing page or `#fragment` fails; a link that lands on a redirect page without a fragment passes).
11. `CHANGELOG.md`: one line under Unreleased when the article ships a new feature or pipeline change, not for ordinary content. Not enforced.

**Verify**

```sh
npm run check
npm test
npm run gate
npm run links
ls dist/writing/<slug>/index.html
grep -l '<slug>' dist/rss.xml
grep -c '<slug>' dist/social.json
```

The `ls` and the RSS `grep` apply only once the `pubDate` has passed. A scheduled article has no page yet: it appears in `dist/social.json` as a stub, and the `grep -c` on `dist/social.json` is the check. A draft appears nowhere, and all three commands then print nothing or `0`.

<a id="add-a-standalone-post"></a>
## 3. Add a standalone post

1. `src/content/social/<id>.md`: create it with the fields in README "Add a standalone post". The file name is the id. Not enforced: the id format (lowercase, such as `p13`) is a convention.
2. The same file, `pillar`, `short` and `status`: `pillar` is from the closed list in `src/lib/tags.ts`; `short` is at most 300 characters including the URL, and holds exactly one `https://pearse.dev` URL, a deep link to `/work/<slug>/` (a case study, not a smaller build or a redirect) or to `/writing/<id>/` (an article with `draft: false` dated on or before the post's `date`), with a trailing slash and no fragment or query; any self-origin URL in the body follows the same rule, and the body may have none. Enforced by: the social schema in `src/content.config.ts`, `tests/post-short-cap.test.mjs`, the link rule in `src/lib/standalone-links.ts` run by `buildFeed` in `src/lib/feed.ts` for approved posts and by `tests/standalone-links.test.mjs` for every post, drafts included.
3. The same file, `status: draft`: keep it until the copy is reviewed. A draft is never in the social feed. Enforced by: `tests/social-feed.test.mjs`.
4. The same file, `status: approved`: set it only after a human has read the copy. Not enforced by the site: the build cannot tell who approved. The scheduler still asks a human before it sends anything (ADR 0004, `automation/n8n/`).
5. The same file, any `[VERIFY: …]` marker in the body or any frontmatter field except `note`: an approved post with one fails the build. Enforced by: the social schema (frontmatter), `buildFeed` in `src/lib/feed.ts` (body too) and the `dist/` backstop in `tests/verify-marker.test.mjs`.
6. The same file, `date`: the day it should go out, in UTC. An approved post appears in the feed straight away, even when dated in the future. Not enforced.
7. The same file, the body: LinkedIn copy with no customer, owner, hostname, address, credential or price. Enforced by: `npm run gate`, which scans `src/`, and only where the local pattern file exists.
8. To retire a standalone post instead: delete `src/content/social/<id>.md`, never reuse the id for new copy, and update any `docs/verify-answer-sheet.md` entry and any test that names it. The scheduler's idempotency key and the Approve/Skip callback data are built from the post id (`idempotencyKey` in `automation/n8n/select.mjs`), so new copy under an old id could be taken for a post that was already handled. Not enforced: nothing records retired ids.

**Verify**

```sh
npm run check
npm test
npm run gate
npm run links
grep -c '<id>' dist/social.json
```

The `grep -c` prints a non-zero count once the post is `approved` and `0` while it is a draft.

<a id="rename-or-fold-a-case-study"></a>
## 4. Rename or fold a case study

A rename or a fold keeps the old URL alive as a redirect page. The old slug becomes a public path in `dist/`; check that it is not a name that must stay private before you list it (ADR 0005 holds the exception for the existing ones).

1. `src/content/projects/`: rename the file and `slug`, or, for a fold, move the content into the target as a `sections` entry (a unique `id` per case study) and delete the old file. Enforced by: the schema in `src/content.config.ts` (a duplicate section id fails the build).
2. `astro.config.mjs`, `MOVED_CASE_STUDIES`: add `<old-slug>` with its new path, `/work/<new-slug>/` or `/work/<target-slug>/#<section-id>`. The build then writes a redirect page at the old `/work/<old-slug>/` and `quietRedirects` keeps the old slug out of its text. Not enforced when you forget: nothing compares the map to the slugs that used to exist, so the old URL becomes a 404. Once an entry exists, `tests/mts-products.test.mjs` checks the map and the built redirect pages (count, meta refresh, sitemap).
3. `tests/mts-products.test.mjs`, the list of old URLs and where they went: add the same slug and target. Enforced by: the same file, whose agreement test fails when the map in `astro.config.mjs` and the list in the test differ in either direction.
4. `docs/adr/0005-confidentiality-denylist-outside-the-repo.md`: add a line naming `/work/<old-slug>/` to the legacy-stub exception. Enforced by: `tests/mts-products.test.mjs` (every redirect page must be named there).
5. The redirect target, when it has a `#<section-id>`: the section must exist on the target page. Enforced by: `tests/mts-products.test.mjs`.
6. Posts whose `project:` names the old slug: change it to the new slug. Enforced by: `tests/related-posts.test.mjs`, which needs a file in `src/content/projects/`.
7. Links in other copy to `/work/<old-slug>/`: change them to the new page. Not enforced: the link crawl follows the redirect page, so a plain link still passes; a `#fragment` onto a redirect page fails `npm run links`.
8. Standalone posts in `src/content/social/` whose `short` or body links `/work/<old-slug>/`: change the link to the new case study, or to a live article. Enforced by: `tests/standalone-links.test.mjs`, which fails on a slug that is no longer a case study, drafts included.
9. The case study's `social` block, if it has one: its feed id is the slug, so a rename gives the feed a new id. Not enforced.
10. `lighthouserc.json`: when the renamed page is an audited URL (`/work/mts-hub/`, `/work/pearse-dev/` or the pinned article), update the URL there. Enforced by: the CI `lhci` step only. `tests/excerpts.test.mjs` pins the source-excerpt case study in the list.
11. `CHANGELOG.md`: one line under Unreleased. Not enforced.

**Verify**

```sh
npm run check
npm test
npm run gate
npm run links
ls dist/work/<new-slug>/index.html
grep -l 'http-equiv="refresh"' dist/work/<old-slug>/index.html
grep -c '/work/<old-slug>/' dist/sitemap-0.xml
```

For a fold with no page of its own, drop the `<new-slug>` line and check the target page instead. The sitemap `grep -c` must print `0`.
