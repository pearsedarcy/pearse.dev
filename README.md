# pearse.dev

Personal site of Pearse D'Arcy. Static, built with [Astro](https://astro.build) 7, Tailwind CSS v4 and a small amount of Three.js. Deployed to GitHub Pages at <https://pearse.dev>.

## Stack

- **Astro 7** — static output, content collections, `@astrojs/rss`, `@astrojs/sitemap`
- **Tailwind v4** via `@tailwindcss/vite`, configured in CSS (`src/styles/global.css`, `@theme` block) with `@tailwindcss/typography` for prose
- **Three.js** (tree-shaken) — hero icosahedron and the About-section stack object, loaded after first paint
- **GSAP** core + ScrollTrigger + SplitText — scroll reveals, loaded on idle
- **Fonts** — Archivo (display, expanded), Inter (body), JetBrains Mono (labels), self-hosted from `@fontsource-variable/*`, latin subset only

Node 22.23.4 or newer (`.nvmrc` / `engines`; see Requirements).

## Commands

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # -> dist/
npm run preview    # serve dist/
npm run check      # astro check (types + content schema)
npm run links      # verify every internal link in dist/ resolves
npm run gate       # confidentiality gate (see Checks)
npm test           # node:test suites under tests/ (builds first via pretest)
npm run test:ci    # the same suites with no pretest build (CI, after its one build)
npm run og         # regenerate public/og-default.png with headless Chrome
npm run og:pages   # render per-page cards to public/og/ (also runs as prebuild)
npm run cv:pdf     # print /cv/ to dist/pearse-darcy-cv.pdf (also runs as postbuild)
```

Tests strip HTML, decode entities and check hosts only through `tests/lib/sanitise.mjs` (#250): `stripTags` and `textOf` take the text from the parser in `tests/lib/html.mjs`, `decodeEntities` decodes each entity once, and `isHost`, `isHostOrSubdomain` and `mentionsHost` compare parsed hostnames, so `evil-github.com` and `github.com.evil` are not `github.com`. It is the only sanctioned way: never write `.replace(/<[^>]+>/g, ...)`, a chain of `.replace(/&amp;/g, ...)` or `.includes('<host>')` in a test or script (CodeQL flags all three), and never add a `codeql[` suppression. `tests/sanitise.test.mjs` covers it.

## Content

Everything editorial is Markdown in `src/content/`, validated by the schemas in `src/content.config.ts`. A missing or mistyped field fails the build.

### Content model

Case studies are the `projects` collection, grouped by `category`:

| Category | What it is |
|---|---|
| `mts` | Day-job work. Exactly two: MTS Hub and wetlabs.app. |
| `client` | Commissioned work for a named client. Gated by `clientPermission`. |
| `tool` | Personal and internal tooling (the agent workflow, the keypad driver, small utilities). |
| `learning` | Side projects built to learn something. |

There is no separate `personal` category: personal projects are `tool` or `learning`. Visibility is two independent flags:

- `visibility: public | private` says whether the source is public. It only decides the repository line: `public` links `repo`, `private` shows "Private repository" and never links. MTS repositories are private.
- `clientPermission` hides a client case study everywhere until it is `granted` or `anonymised` (table below). Other categories ignore it.
- `smallerBuild: true` turns an entry into one row of the /work/ "Smaller builds" list: no page, no card number, no Open Graph card, no feed entry, and not on the home grid or /cv/. The row shows title, oneLiner, period, stack and the repository line; body, features and hooks are kept but not rendered. Default `false`. Rule of thumb, not a check: a body under about 30 words is a smaller build. See [ADR 0007](docs/adr/0007-smaller-builds-are-a-list-not-case-studies.md).

Posts follow a third rule: `draft: true` or a future `pubDate` keeps an article off the pages and RSS (see Add a post). Standalone social posts need `status: approved` to reach the feed.

The two-products rule, the permission flags and the reasoning are in [ADR 0006](docs/adr/0006-mts-is-two-products-and-client-work-is-gated.md). Source briefs used to draft content (writing, design and research notes) are kept privately outside the repository; nothing here links to them. Anything that would name a customer, address, credential or figure is stopped by the gate (see Checks).

Every visible case study closes with a contact block (after "Writing about this project", before Previous/Next; `src/lib/contact.ts` picks the variant) with a mailto link titled "About <project>" from `aboutProjectHref` in `src/lib/mailto.ts` and three variants: `private` offers a walkthrough call and links nothing, `repo` (public with `repo`) links that repo, `public` (no `repo`) is the mailto alone. `tests/case-contact.test.mjs` asserts it on every page.

To add a case study: pick the category, create `src/content/projects/<slug>.md` as under Add a project, set `clientPermission` explicitly if it is a client, run `npm run build && npm run gate && npm test`. For an MTS tool, add a `sections` entry to MTS Hub or wetlabs.app instead. To add a post: see Add a post. Changes are logged in [`CHANGELOG.md`](CHANGELOG.md).

### Add a project

Create `src/content/projects/<slug>.md`. The numbered checklist, with what enforces each step, is [Add a case study](docs/content-checklists.md#add-a-case-study); for a rename or fold use [Rename or fold a case study](docs/content-checklists.md#rename-or-fold-a-case-study).

```yaml
---
title: Project name
slug: project-name          # used in /work/<slug>/
oneLiner: One sentence, what it is and for whom.
period: Jan – Mar 2026
role: Sole engineer         # optional, defaults to "Sole engineer"
stack: [Django 5, PostgreSQL]
featured: true              # home page shows six cards: featured first, then backfilled by order to six
order: 7                    # /work/, case-study numbers, Previous/Next and OG cards group by category
                            # (mts, client, tool, learning) and sort by order within a group; the home
                            # page uses plain order. The displayed number is the position in that
                            # sequence, not this raw value
features: ["…", "…"]
hooks: ["…", "…"]           # 2–3 pull-quote facts
repo: https://github.com/…  # optional; omit for private work
live: https://…             # optional
visibility: private         # private | public
category: mts               # mts | client | tool | learning
clientPermission: pending   # client case studies only; pending | granted | anonymised (default pending)
smallerBuild: false         # optional; true = a row in the /work/ Smaller builds list, no page (ADR 0007)
outcome: One before/after sentence.   # optional; max 160 chars, no digits; shown under the title
outcomes:                   # optional; 1–4 engineering metrics, shown after Role/Period/Code
  - value: "6000+"          # max 8 chars; restates a figure already in this page's copy
    label: automated tests  # max 40 chars
diagram: MtsHub             # optional; names an architecture diagram, see Diagrams
excerpts: [visibility-rules] # optional; source excerpts by id, see Source excerpts
social:                     # optional; puts the case study in /social.json as a `project` entry
  date: 2027-02-17          # planned posting date
  linkedin: |
    LinkedIn copy, ending with the case study URL.
  short: "≤ 300 chars incl. the URL"
sections:                   # optional feature sections, rendered under "What it does, in depth"
  - id: packing             # anchor: /work/<slug>/#packing
    title: Packing, inventory and fleet
    origin: Began as a standalone packing tool in Feb 2026.   # optional; no product names
    summary: One short paragraph.
    features: ["…", "…"]
    stack: [Celery]         # optional chips
    diagram: MtsCortex      # optional; same names as `diagram:`
process:                    # optional, client only; rendered as "How the job ran" after the body and sections
  - step: audit             # audit | staging | gated | cutover | written-down, in that order, two or more
    proof: One sentence (max 160 chars) from this page that backs every clause of the step's promise.
---
Optional notes in Markdown, rendered under the facts.
```

`process` is for client case studies only; on any other category the build fails. The step titles and promises are shared and live in `src/lib/process.ts`; an entry cannot override them. Each `proof` paraphrases a line on the same page and must back every clause of its step's promise, adding no number, name, host or tool the page does not already state. List a step only when the page backs it. `tests/process.test.mjs` pins the steps per case study and checks that each proof's numbers and proper nouns appear elsewhere on its page.

`outcome` and `outcomes` are engineering metrics only: no money, no %, no business counts; every figure must already be stated in the page's own copy. The schema rejects currency symbols and codes, `%` and the verify marker in any of them, a digit in `outcome`, business-count words (customers, clients, attendees, participants, delegates, users, revenue, sales, bookings, orders) in a `label`, and the length and count caps; the rules live in `src/lib/outcomes.ts`. The case page renders `outcome` between the title and the one-liner and the row as `<dl class="case-outcomes">` (2 columns on phones, 4 from 48rem); a large home card shows the first two as `<dl class="card-outcomes">`, medium cards and /work/ none. The validator cannot tell a business figure from an engineering one, so `tests/outcomes.test.mjs` pins every committed row to an allowlist with the source phrase each figure restates: a new figure is a reviewed edit to that list. Today only MTS Hub and wetlabs.app carry a row. See GLOSSARY "Outcome".

A granted client case study titled by its domain must set `live`, and `tests/client-live-link.test.mjs` enforces it.

MTS is presented as exactly two case studies, **MTS Hub** and **wetlabs.app**. Its smaller tools (WetPack, Opthalyze, Atlas, Cortex, the observability stack) are feature sections of those two, not case studies of their own, and the case studies describe them as features without their old names. The video platform's old name appears nowhere in `dist/`, in any letter case; `tests/mts-products.test.mjs` holds both rules.

When a case study is renamed or folded into another, add its old slug to `MOVED_CASE_STUDIES` in `astro.config.mjs`. The build writes a static redirect page (`<meta http-equiv="refresh">`, canonical, noindex, no JavaScript) at the old `/work/<slug>/`, kept out of the sitemap. The `quietRedirects` integration rewrites those pages so their text never repeats the old slug.

`clientPermission` gates **client case studies** (`category: client`) and is ignored for every other category.

| Value | Meaning |
|---|---|
| `pending` (default) | No permission yet. The case study is excluded from the home grid, `/work/`, its own page, the sitemap, "next" links and writing-post project links. |
| `granted` | Client agreed to be named. Published as written. |
| `anonymised` | Client agreed on condition of anonymity. Published; the copy must already be anonymised. |

Set the value explicitly on every client case study. `tests/visibility.test.mjs` unit-tests the rule for every value, asserts that `granted` ones are on `/work/` under Client work, and that `pending` ones (read from the source files) are absent from the build.

A client case study names no owner or staff member, no server name or address, and no prices or business figures, whatever its permission value.

Private repositories show "Private repository" and never link.

### Diagrams

A case study can show one architecture diagram under its features, in a figure headed "How it fits together". The frontmatter key `diagram:` names a component in `src/components/diagrams/`; without the key the page has no figure.

To add one:

1. Copy an existing diagram (say `MtsCortex.astro`) to `src/components/diagrams/<Name>.astro`.
2. Describe two layouts in viewBox units: `wide` (shown from 64rem up, about 960 wide) and `narrow` (phones, 360 wide, stacked). Each is a list of `nodes` (box, label, optional `sub` lines, `kind`: service, store, actor, ai or gate for a human approval point) and `edges` between node ids (`flow` for the main path, `both` for two-way, `optional` for opt-in, `rollback` for a fallback path that is kept ready but not taken: drawn in steel with its own dash-dot pattern, never animated; it needs a `label` and cannot also be `flow`, or the build fails). Edges route orthogonally; use `fromSide`/`toSide`, `fromOff`/`toOff` or `via` when the default crosses a box.
3. Give `Diagram` a `title` and a `desc` that tells the flow in sentences, for screen readers.
4. Add `<Name>` to `DIAGRAM_NAMES` in `src/lib/diagrams.ts` and to `DIAGRAMS` in `src/components/diagrams/index.ts`, then set `diagram: <Name>` on the case study, or on one of its `sections`.

These steps, with what catches a miss in each, are items 7 to 10 of the [Add a case study](docs/content-checklists.md#add-a-case-study) checklist.

Name only components the case study or its linked article already names: no hostnames, addresses, customer names or counts. The build fails when a label is too long for its box. Flow edges animate only under `prefers-reduced-motion: no-preference`. Check both layouts at 390 and 1280 px; `tests/diagrams.test.mjs` asserts which titled diagrams each case study renders, and fails on any diagram text that looks like a path (a slash with no space on either side, `~/`, or a `.sh`, `.md` or `.json` name) or an MTS repo slug.

### Source excerpts

A case study can show a few lines of this repository's own code under "Code from this repo" (#152). Today only `/work/pearse-dev/` does. The code is read from the source files at build time, so it always matches what ships, and each excerpt links to its exact lines on GitHub, pinned to the built commit (`GITHUB_SHA` in Actions, `master` in a local build).

A region is marked in its source file by an `excerpt:start <id>` comment line and an `excerpt:end <id>` comment line, in the file's own comment syntax. The line above the start marker says the region is rendered on the site. The markers are the only lines added to the source file.

To add one:

1. Add the id to `EXCERPT_IDS` in `src/lib/excerpts.ts` and give it metadata in `EXCERPTS`: the repository path, the Shiki language and a one-sentence caption.
2. Add a `?raw` import of the file to `EXCERPT_SOURCES` in `src/lib/excerpt-sources.ts`, the only module that does `?raw` imports. It is typed by the id, so a missing entry fails `npm run check`.
3. Put the render note and the two markers around the region. Keep it to 30 lines or fewer.
4. List the id under `excerpts:` on the case study. The section renders only when the list is non-empty.

The build fails, by design, when a marker is missing or doubled, the end comes before the start, the region is empty, or it is longer than 30 lines. Editing code inside a marked region changes the page, and can fail the build: shorten the region or move its markers rather than raising the cap. Captions follow the same rules as diagrams: no hostnames, customer names or private repositories. `tests/excerpts.test.mjs` covers the extractor, the three regions and the built page.

### Add a post

Create `src/content/posts/<slug>.md`. The filename is the URL: `/writing/<slug>/`. The numbered checklist, with what enforces each step, is [Add an article](docs/content-checklists.md#add-an-article).

```yaml
---
title: Post title
description: Used as the meta description. Length limit: see the posts schema in src/content.config.ts.
pubDate: 2026-11-03
updatedDate: 2026-11-10     # optional
tags: [django, architecture]
project: mts-hub            # optional, a project slug; links the post and the case study
series: mts-hub             # optional, with seriesOrder: mts-hub | wetlabs-app (src/lib/series.ts)
seriesOrder: 1              # positive integer, unique within the series
draft: false
social:
  linkedin: |
    Long-form LinkedIn version, first line is the hook.
  short: "≤300 chars incl. URL, for X/Bluesky/Mastodon."
---
```

`series` and `seriesOrder` come as a pair or not at all. They put a "Part n of m" box on the article, listing only the published parts in `seriesOrder` order, once at least two are live; a duplicate order in one series fails the build, drafts included.

`tags` is a closed list of one to three terms, validated by the schema, so an unknown tag fails the build. The vocabulary lives in `src/lib/tags.ts`; each tag maps to one of the four content pillars (Platform building (Django), Self-hosted AI in production, Agentic engineering, Career). A new tag is added there and must be carried by at least two posts (`tests/post-tags.test.mjs`).

Drafts are excluded everywhere. Posts dated in the future are excluded from the HTML pages and RSS until their `pubDate`; the deploy workflow rebuilds every day at 04:23 UTC so they go live on their date. GitHub disables scheduled workflows after 60 days with no repository activity, so `.github/workflows/keepalive.yml` re-enables the deploy workflow weekly. That works only if the enable call resets GitHub's inactivity counter, which GitHub does not document; the fallback is a push to `master` at least every 60 days.

### Social feed

`/social.json` lists every non-draft article (including scheduled ones), every approved standalone post and every visible case study with a `social` block, oldest first (on one date: articles, then standalone posts, then case studies). Each entry has a `kind`:

```json
[
  { "kind": "article", "id": "…", "slug": "…", "title": "…", "date": "2026-11-03", "pubDate": "2026-11-03",
    "url": "https://pearse.dev/writing/…/", "published": true, "status": "approved", "tags": ["…"],
    "social": { "linkedin": "…", "short": "…" } },
  { "kind": "article", "id": "…", "date": "2026-11-10", "published": false },
  { "kind": "standalone", "id": "p01", "title": "…", "date": "2026-11-04", "pillar": "Agentic engineering",
    "format": "Short lesson", "visual": "none", "published": true, "status": "approved",
    "social": { "linkedin": "…", "short": "…" } },
  { "kind": "project", "id": "east-coast-blinds", "title": "…", "date": "2027-02-17", "category": "client",
    "url": "https://pearse.dev/work/east-coast-blinds/", "published": true, "status": "approved",
    "social": { "linkedin": "…", "short": "…" } }
]
```

Articles keep their original fields (`slug`, `pubDate`, `url`, `tags`); `id` and `date` are the same values under the shared names. A scheduled article (future-dated, so no page yet) is a stub with exactly `kind`, `id`, `date` and `published: false`: no title, URL, tags or copy until the daily rebuild on its date turns it into the full entry with `published: true`. The id stays in the feed so the scheduler knows it exists, and it must never link a stub. Standalone posts have no page and no `url`, and are always `published: true`. A `project` entry's `id` is the case study slug and its `url` the case study page, which always exists for a visible case study, so it is always `published: true`; pending client case studies are never in the feed. The scheduler does not offer `project` entries yet (`isEligible` in `automation/n8n/select.mjs` returns false for any other kind).

An n8n workflow reads it to schedule posts: LinkedIn gets the `linkedin` copy, and Bluesky and Mastodon optionally get the `short` copy (see [`automation/n8n/README.md`](automation/n8n/README.md)). `/rss.xml` carries the published posts.

### Add a standalone post

A standalone post is social copy with no article. Add `src/content/social/<id>.md`; the filename is the id (lowercase, e.g. `p13.md`). The numbered checklist, with what enforces each step, is [Add a standalone post](docs/content-checklists.md#add-a-standalone-post):

```md
---
title: "Write the rule as a hook, not a sentence"
date: 2026-11-04                 # the day it should go out (UTC)
pillar: "Agentic engineering"    # Platform building (Django) | Self-hosted AI in production | Agentic engineering | Career
format: "Short lesson"           # free text: Short lesson, How we do X, Before/after, …
visual: "none"                   # what to attach, or "none"
status: draft                    # draft | approved
short: "≤300 chars incl. URL, for X/Bluesky/Mastodon. https://pearse.dev"
note: "optional reviewer note"   # optional, not in the feed
---

The LinkedIn copy is the body, first line is the hook.
```

- `draft` (the default) is never in the social feed. Resolve every `[VERIFY: …]` marker before approving.
- One rule covers every published kind: the build fails on an approved standalone post, a non-draft article (past-dated or scheduled) or a visible case study (with or without social copy) that still has a marker in its body or in any frontmatter field, nested strings included, except the fields in the exemption list `VERIFY_EXEMPT` (today only the standalone `note`). The error names the kind, the id and the field paths, never the marked text. The rule lives in `src/lib/verify-marker.ts`; `npm test` also fails on a marker in any built text file in `dist/`, which covers `/now/`, `/cv/` and the other pages with no feed entry.
- `approved` is in the feed straight away, even when dated in the future, so the scheduler can plan around its `date`. The scheduler still asks for a human approve before sending anything (ADR 0004).

The collection is the source of truth: edit the Markdown directly. The first twelve were migrated from a JSON file that has since been deleted; `scripts/migrate-standalone.mjs` is kept only as the record of that migration and must not be re-run.

### Now page

`/now/` renders `src/content/now/now.md`. To update it, edit the file and bump `updated` in the frontmatter; the page shows it as "Updated <Month YYYY>". Keep it public-safe (see ADR 0005). The file holds no address: the page template adds "Write to <address>." straight after the content, so "Open to conversations" must stay the last section (`tests/mailto.test.mjs` checks the order).

### Contact and mailto links

Every mailto on the site comes from `src/lib/mailto.ts` (#153), and no page, component or content file may contain the literal address (only `src/lib/site.ts` holds it) or a `mailto:` outside comments; `tests/mailto.test.mjs` fails on either. The address is always `SITE.email`. Subjects are a closed set, one constant per context (`home`, `cv`, `now`, `brief`); the only other subject is a case study's "About <title>" on its own page. No user-typed text ever goes into a subject. `buildMailto(context, body)` percent-encodes per RFC 6068 (line breaks as `%0D%0A`), caps the body at `MAX_BODY` code units and the href at `MAX_HREF` characters, reports `truncated`, and returns the same content as plain text for the clipboard. The module imports only `./site.ts`, so the unit tests load it under Node's type stripping and the home contact script can import it alone.

The home `#contact` section and the `/cv/` contact line have a Copy button beside the address; it is reserved with `visibility` from first paint and shown only when `navigator.clipboard` exists, and `/cv/` hides it in print. `#contact` also has a brief form: without script it is a native `method="get"` form to the bare mailto address with a hidden `subject` and a `body` textarea, the only named fields; with script, submit goes through `buildMailto('brief', …)` and "Copy brief" copies the plain text, for webmail and for briefs over the cap.

### Impressum

`/impressum/` is built from one block, `LEGAL` in `src/lib/site.ts`, typed `LegalBlock | undefined` and kept outside `SITE` (#155). It holds the page heading, the name, the address lines, a list of headed sections and optional label/value details. The code has no wording of its own: every heading and paragraph comes from the block, and the footer link label "Impressum" is the only fixed string. There is no email field; the page shows `SITE.email`, so it cannot drift from the footer and the home contact block.

`legalState()` in `src/lib/legal.ts` (import-free, so the tests load it under type stripping) sorts the block into one of three states, and the dynamic route `src/pages/[legal].astro` acts on it:

- **unset** (`undefined`, as shipped): no page, no footer link, nothing in the sitemap.
- **incomplete** (a required field missing, blank or an empty array): the build fails and names every missing field.
- **complete**: the build emits `/impressum/` with robots `noindex` (the `Base` prop), the footer links it, and `astro.config.mjs` keeps it out of the sitemap.

The block ships unset. Real values and wording arrive only through the human-only follow-up issue, after `npm run gate` passes with the real denylist. `tests/impressum.test.mjs` covers the states with placeholder fixtures and checks the shipped build; its complete-state branch runs only with a block set locally.

### CV

`/cv/` is built from the site: contact links and location from `src/lib/site.ts`, the featured case studies and the MTS ones that are visible (pending client case studies are excluded, as everywhere; only the start of each period is shown, and roles are left to the case study pages), and the marquee stack as skills. Facts that exist nowhere else on the site (headline, profile, experience, education, and languages once confirmed) live in `src/content/cv/cv.md`; their wording follows `docs/profile/`, and nothing that still carries a verify marker there goes in. The page has a print stylesheet (A4, black on white, no nav or footer, links spelled out, entries never split across pages). Keep it at two pages or fewer when adding content: `npm test` fails on a third.

"Download PDF" is a plain link to `/pearse-darcy-cv.pdf` with a `download` attribute, so it works without JavaScript and hands recruiters a file to attach. The file is printed from the built page by `scripts/cv-pdf.mjs`, which runs as `postbuild` (and alone as `npm run cv:pdf`): it serves `dist/` on a throwaway 127.0.0.1 server for the length of the step, rewrites the root-relative links in the copy of `/cv/` it serves (never in `dist/`) to `https://pearse.dev/`, so the PDF's links are public, and prints with headless Chrome (`--no-pdf-header-footer`, the page's own `@page` rules). It deletes any old PDF first and writes `.astro/cv-pdf.json` (`{ chrome, pdf, pages }`) for the tests. Next to the link, a "Print" button (`window.print()`) appears once JavaScript runs; it is the fallback whenever the link is gone. The page never ships a link to a missing file:

| Situation | PDF | Link in `dist/cv/index.html` | Exit |
|---|---|---|---|
| Chrome found, print OK | written | kept | 0 |
| No Chrome, not CI | none | removed | 0, with a warning |
| No Chrome, `CI` set | none | removed | 1 |
| Chrome found but the print fails, times out or writes no, an empty or an unreadable file (CI or not) | deleted | removed | 1 |

"No Chrome" means `findChrome()` (`scripts/og-shared.mjs`) found none; an invalid `CHROME_PATH` still falls back to PATH. To try the no-Chrome path locally, reduce PATH to the Node bin directory and give npm an absolute shell: `/usr/bin/env PATH="$(dirname "$(command -v node)")" CHROME_PATH=/nonexistent npm run --script-shell=/bin/sh cv:pdf`.

### GitHub section

Section 04 on the home page shows the public GitHub profile of `pearsedarcy`: a profile card (public repos and, when the calendar is available, last year's contributions, with a note that most of the work is in private repositories), the last year's contribution heatmap (inline SVG, no client JS) and six repository cards. Every link goes to github.com. `src/lib/github.ts` fetches it once per build:

- Profile and repositories come from the REST API, no token needed. The cards are an allowlist that fails closed: a repository is shown only if it is public, owned by `pearsedarcy` (never an org) and named in `FEATURED_REPOS` or `SHOWN_REPOS` in `src/lib/github.ts`; the fork flag does not matter for a listed name, and anything unlisted is skipped. Featured repositories come first in list order, then shown ones by last-push day (UTC, newest first), with list order breaking ties, capped at six. Every listed name needs an entry in `DESCRIPTION_OVERRIDES` or `DESCRIPTION_FALLBACKS`. To show a new repository, add its name and its copy in the same pull request.
- The build logs the public repositories it skipped. Locally the line names them; when `CI` is set it logs only the count, because Actions logs on a public repository are public.
- The contribution calendar comes from GraphQL `contributionsCollection`, which needs `GITHUB_TOKEN`. CI and the deploy pass `github.token`.
- `src/data/github.json` is the committed, already-shaped snapshot. Reading it applies the same repository rule (unlisted repositories dropped, re-ordered, capped) and the avatar-host check. Without network the build uses it whole; without a token it keeps the snapshot's calendar. Either way it logs a `[github]` warning saying so. A successful fetch rewrites the file when the data changed, so a local build with network may leave it modified: commit it or `git checkout` it.
- `GITHUB_FETCH=0` forces the snapshot (offline builds, reproducible tests).
- The profile avatar is self-hosted, so no built page loads anything from GitHub's avatar CDN. `src/assets/github-avatar.jpg` is committed (a 160x160 JPEG, no metadata) and is the source of truth: the card imports it and renders it with astro:assets `<Picture>` (AVIF and WebP at 80 and 160 px, JPEG fallback). A live build only refreshes it. After shaping the profile, `loadGithub` downloads `avatarUrl` (https on the avatar host, `image/*`, at most 256 KB), has sharp decode it, resize to 160x160 cover, encode a JPEG at a fixed quality and drop all metadata, and writes the file only if those normalised bytes differ from the committed ones. Any failure (offline, `GITHUB_FETCH=0`, wrong host or type, oversize, decode error) keeps the committed file and logs one `[github]` warning. **One build behind:** Astro reads the static import before page frontmatter runs `getGithub()`, so the build that fetches a new avatar still renders the committed one and the new bytes show from the next build. The deploy build commits nothing (ADR 0003), so a refreshed avatar only matters locally: commit `src/assets/github-avatar.jpg` or `git checkout` it. `avatarUrl` stays in `src/data/github.json` as the refresh source; no page renders it.
- `tests/github.test.mjs` covers the shaping, the fallback paths and the avatar refresh with a fake `fetch`, and the rendered section and avatar markup. `tests/no-third-party-origins.test.mjs` is the origin test, described under Checks.

## Site config

`src/lib/site.ts` holds three optional fields for the Fediverse and Bluesky. All three ship **unset** (`null`, typed `string | null` so the set branch is type-checked), and nothing new renders until they are filled in. Putting a real value in is a one-line change per field.

- `mastodon`: the full `https://` profile URL. When set, the footer gets a Mastodon link.
- `bluesky`: the full `https://` profile URL on bsky.app. When set, the footer gets a Bluesky link.
- `atprotoDid`: the Bluesky DID (`did:plc:…` or `did:web:…`). When set, the build emits `/.well-known/atproto-did` whose body is exactly the DID, which is what lets Bluesky use `pearse.dev` as a handle. While it is unset the build contains no such file.

The footer links come from `profileLinks(SITE)` in `src/lib/profile-links.ts`: GitHub, LinkedIn, then Mastodon and Bluesky when set, each with `rel="me"`. The footer is in the shared layout, so every page carries them; Source, Now, CV, RSS and social.json do not. A set value that is not an `https://` URL, or a DID that does not match `^did:(plc|web):[A-Za-z0-9._:%-]+$`, fails the build. `tests/social-links.test.mjs` covers the set state with placeholder values and the shipped build by reading `SITE`.

After the values are set and deployed, two steps are by hand:

1. On Mastodon, add `https://pearse.dev` as a profile metadata link. Mastodon fetches the page and looks for the `rel="me"` link back to the profile.
2. In the Bluesky app, set the handle to `pearse.dev`. Bluesky reads `https://pearse.dev/.well-known/atproto-did`.

**Bluesky DNS fallback.** If the well-known file does not reach the deployed site, or DNS is preferred, add a TXT record in Cloudflare: name `_atproto`, value `did=<DID>`. The deploy uploads `dist/` with `actions/upload-pages-artifact@v5`, which leaves out dot-directories unless `include-hidden-files: true` is set; `check.yml` sets it (#140, for `security.txt`), so `/.well-known/` ships. Still check `curl https://pearse.dev/.well-known/atproto-did` after the first deploy with a DID set and use the TXT record if it answers 404.

## Open Graph images

Every article and visible case study page gets its own 1200x630 card at `/og/<slug>.png`: the title in Archivo, a mono kicker (date and reading time for an article, order, category and period for a case study), the icosahedron mark and `pearse.dev` above the lime bar. Home, index and 404 pages keep `public/og-default.png`, which is committed and regenerated by hand with `npm run og`.

- `scripts/og-pages.mjs` renders the cards with headless Chrome, not satori, because the Archivo width axis only renders faithfully in a browser. It runs as `prebuild`, so `npm run build` (and `withastro/action` on deploy) always regenerates them; `npm run og:pages` runs it alone. Four renders run in parallel, about 2 s for the current pages.
- `public/og/` is generated and gitignored. The script empties it first, so a post that goes back to draft loses its card.
- Which pages get a card follows `src/lib/visibility.ts`, the same publish and visibility rules the pages use: drafts, future-dated articles and `pending` client case studies get none.
- Chrome comes from `CHROME_PATH`, then `google-chrome`, `chromium` or `chromium-browser` on `PATH`. Without one the script warns and every page falls back to the default image, so a local build never fails on it; under `CI` it fails instead. `src/lib/og.ts` picks the page card only when its file exists.
- `og:image:alt` (and `twitter:image:alt`) reads `<Title>, Pearse D’Arcy, pearse.dev`; `twitter:image` mirrors `og:image`.
- `tests/og.test.mjs` checks one distinct card per page, each a real PNG over 10 KB, none for drafts or pending client case studies, and the default on every other page. It skips the image assertions when the build had no Chrome (`.astro/og-pages.json` records the run).

## Motion and degraded paths

- **The scene gate** (`src/lib/scene-gate.ts`, one pure rule, `tests/scene-gate.test.mjs`). The full 3D scenes (the hero icosahedron and the five-layer stack) are for capable, motion-tolerant desktop visitors. A visitor stays on the build-time SVG poster, and never fetches three.js, when any of these is true: WebGL is unavailable; `prefers-reduced-motion: reduce`; the browser sends Save-Data (`navigator.connection.saveData`, where the API exists); the viewport is narrower than 640 px; or `?lite` is in the URL. Both components build a probe (`sceneProbe()` in `src/scripts/env.ts`) inside their deferral (`onIdle` for the hero, the IntersectionObserver for the stack) and import the scene module only when the rule returns `'gl'`.
- Reduced-motion and Save-Data visitors get the poster. The poster is not claimed to be pixel-identical to the single frame the scenes used to draw under reduced motion; that is a product decision, not a parity claim.
- `isLowEnd()` (four cores or fewer, or under 640 px) is separate: it lowers detail on desktop scenes that do load, and is not part of the gate.
- The marquee and the letter reveal also stop under reduced motion.
- **The GSAP chunk** (`motion.*.js`) is only fetched when the page has motion targets (`src/lib/motion-gate.ts`: `[data-split]`, `[data-reveal]`, `.hero-letter:not(.is-space)`) and reduced motion is off, `?reduce` included. `tests/motion-gate.test.mjs` keeps that list in step with `src/scripts/motion.ts`.
- Page-to-page view transitions stop under reduced motion too, in two layers (`tests/view-transition-motion.test.mjs`). The shared layout opts in (`@view-transition { navigation: auto; }`) only inside `@media (prefers-reduced-motion: no-preference)`, so reduced-motion visitors never start one, and the global reduced-motion block sets `animation: none !important` on `::view-transition-group(*)`, `::view-transition-old(*)` and `::view-transition-new(*)` as a backstop. The static `/work/<old-slug>/` redirect pages keep the guarded opt-in. This follows the OS/browser setting only: `?reduce` drives the JS paths (hero, stack) and cannot change a CSS media query, so it does not affect view transitions.
- **The stack layer buttons are toggles in every mode** (#142; `aria-pressed`, at most one pressed, `src/lib/stack-toggle.ts`). The component mirrors the pressed index to `data-active` on `.stack`: the poster slabs (`data-slab`) light or dim from CSS, so phones, Save-Data and reduced-motion visitors get the same state without the scene, and `mountStack` takes it as `pressed` and `setPressed()` keeps the scene in step. Pointer previews ignore touch and focus previews need `:focus-visible`, so a tap shows the pressed layer and nothing sticky.
- Force a path for testing with `?reduce`, `?nogl` or `?lite` on any URL.
- Once the hero script has decided the mode, on every path (no WebGL, gl mounted, import failed), it sets `data-hero-ready` on `#hero-3d`. The attribute exists only at runtime, never in the static HTML, which already ships `data-mode="poster"`. The browser smoke run waits on it to check `?nogl` (poster, no three.js fetched), `?reduce` (with reduced motion emulated: no letter animation, every letter shown) and the default path.

## Checks

`.github/workflows/check.yml` runs on every pull request and is called by the deploy workflow, whose `deploy` job needs it green. It runs `npm ci`, then in order: check (`astro check`), build, a content hash of `dist/`, link crawl, Lighthouse (skipped on the scheduled rebuild, see below), smoke (the browser smoke run below), a11y (the accessibility scan below), `npm run test:ci`, gate (the confidentiality gate), a second hash that must equal the first, and, outside pull requests, the upload of `dist/` as the `github-pages` artifact (`actions/upload-pages-artifact`). The build step is the only build in CI: `test:ci` runs the same suites as `npm test` without its `pretest` build, and under `CI` the Open Graph test fails on a stale or missing `dist/` instead of rebuilding. The hash covers every file in `dist/`, hidden ones included (`.well-known/`), which is what the Pages artifact archives because the upload sets `include-hidden-files: true`, so the site that ships is byte for byte the one the link crawl, Lighthouse, smoke run, accessibility scan, tests and gate checked. Pull requests run every check and upload nothing. The daily scheduled rebuild skips only the Lighthouse budget and its report upload (#154); it still runs check, build, link crawl, smoke, a11y, tests and gate. Any new check goes after the build and before the second hash.

The link crawl (`npm run links`, `scripts/check-links.mjs`, #164) checks every root-relative, pure-fragment (`#x`, the page itself) and self-origin `href`/`src` in `dist/`, where the origin comes from `src/lib/origin.mjs`, the one place it is written (the Astro config and `SITE.url` import it too). It also reads the self-origin URLs in `rss.xml` (`<link>`, `<guid>`), in `sitemap-index.xml` and every sitemap it lists (`<loc>`), and in `social.json`: the `url` and the URLs inside `social.linkedin` and `social.short` of each entry with `published: true`; scheduled entries are skipped whole. A `#fragment` must match an element `id` in the target page, percent-decoded (`data-id` does not count); `#` and `#top` always pass, a non-HTML target (`/rss.xml#x`, the CV PDF) only has to exist, and a fragment to a redirect stub fails, so link to the real page. A failure prints `MISSING <url>  <- <page or feed file>` and exits 1. `tests/check-links.test.mjs` runs the script over temporary trees, never the real `dist/`.

The origin test (`tests/no-third-party-origins.test.mjs`, #115 and #129) keeps the footer's "Static HTML, no tracking" true. The one walker is `tests/lib/origins.mjs`: `resourceUrls(html)` lists every URL a browser fetches without a click (`src` on script, img, iframe, source, video, audio, embed and `input[type=image]`; `srcset` on img and source; `poster`; `object[data]`; `href` and `xlink:href` on SVG `<image>` and `<use>`; `<link href>` whose rel tokens include stylesheet, icon, apple-touch-icon, preload, modulepreload, prefetch or manifest; `url()` and `@import` in `<style>` and `style` attributes), with entities decoded and `<noscript>` content included. `allowedOrigins(token)` returns `https://pearse.dev` alone, and adds `https://static.cloudflareinsights.com` only while `SITE.analyticsToken` is a non-empty string. Every `dist/**/*.html` file, the redirect stubs included, may load only from those origins; a failure names the file and the origin. With the token unset, `cloudflareinsights` appears in no built HTML. `<a href>` and `xmlns` are not scanned. **Limitation:** fetches started by JavaScript in the bundled `_astro/*.js` are not scanned (those bundles hold licence and comment URLs that are not fetches), so the test keeps "no third-party scripts, fonts or embeds" true for markup and CSS only. `tests/privacy.test.mjs` asserts the `/privacy/` page and that every page on the normal layout links it (the meta-refresh stubs are exempt from that assertion only). `SITE.analyticsToken` ships unset and renders nothing by itself: the beacon tag is #20's, and the `/privacy/` analytics paragraph appears together with it.

External links are checked once a week, apart from every build: `.github/workflows/link-rot.yml` (#164) runs on a Thursday schedule and by `workflow_dispatch`, and is never called from `check.yml` or `deploy.yml`, so a dead third-party link cannot block a deploy (ADR 0003). It builds the site and runs lychee (SHA-pinned action, exact binary version) over `dist/**/*.html`, excluding linkedin.com (it blocks bots) and the site's own origin (the link crawl covers it), accepting 429 so a rate-limited github.com does not open an issue every week, with `.lycheecache` kept by `actions/cache`. `scripts/link-rot-report.mjs` reduces the JSON report to failing URLs and the `dist/` pages they are on (no status text, headers or redirect targets; timeouts are not reported), and the job opens, updates or reopens the one issue labelled `link-rot`, or comments on it and closes it when a run passes. Permissions are `contents: read` and `issues: write`; `tests/link-rot-workflow.test.mjs` locks the triggers, permissions, excludes, cache and pins. GitHub disables scheduled workflows after 60 days without repository activity, so this weekly check can go dormant; the keepalive workflow (#100) re-enables only the deploy and itself, and that is accepted.

<a id="confidentiality-gate"></a>
The gate (`scripts/gate.mjs`, ADR 0005) scans `dist/`, `src/` and `docs/` case-insensitively for patterns that must never ship. Patterns come from the repository secret `CONFIDENTIAL_PATTERNS`: one regular expression per line (case-insensitive, multiline: `^`/`$` match per line), blank lines and `#` comments ignored. Every file is scanned except known binary types and files containing a NUL byte. PDFs are the exception among binaries: each `.pdf` is read with `pdfjs-dist` (`scripts/pdf-text.mjs`, shared with the tests and loaded only when a PDF is found) and every pattern is tested against its text (per line, with whitespace collapsed so a phrase wrapped across lines or pages still matches, and with whitespace removed so letter-spaced words read whole), its metadata (every Info value and the raw XMP) and its link targets. A PDF that cannot be parsed fails the gate as `<file>: unreadable PDF`. The `#n` in the output counts patterns (non-empty, non-comment lines), not file lines. The printed path can itself reveal a name, so keep sensitive words out of filenames. Fork and Dependabot PRs receive no secret and so only get the warning. A missing `dist/` fails the gate: build first. Every file is tested against every pattern twice (#108). The **raw pass** is unchanged: the file's own text, flags `im`, `^`/`$` per line. The **normalised pass** tests a normalised copy of the text against a folded copy of the pattern, because the rendered site does not hold names the way a pattern author types them (Astro HTML-encodes quotes as `&#39;` and `&quot;`, smartypants curls apostrophes, an accent can be composed or decomposed, Markdown wraps a two-word name across a line break). Text normalisation (`normalise()` in `scripts/gate-normalise.mjs`) runs in order: decode entities once (numeric references plus `amp lt gt quot apos nbsp lsquo rsquo ldquo rdquo ndash mdash hellip`; `&amp;#39;` becomes the literal `&#39;`; unknown names and out-of-range, surrogate or zero references stay as written), NFKC, strip combining marks, fold curly single quotes and primes to `'`, curly double and low-9 quotes to `"` and hyphens, dashes and the minus sign to `-`, and collapse every whitespace run to one space. Pattern folding (`foldPattern()`) applies the same steps except entity decoding, and leaves text inside `[...]` and the character after a backslash alone, so `\s`, `\b`, `\.` and `[a–z]` mean what they say. An escaped literal such as `\’` is therefore left as written and only matches through the raw pass. A file/pattern pair that hits in either pass is reported once as `<file>: pattern #<n>` and counted once. **Known limitation:** the normalised text has no line breaks, so `^`/`$` anchors match only at its very start and end; an anchored pattern keeps working through the raw pass. A pattern whose folded form does not compile (NFKC can turn a valid pattern invalid, for example a fullwidth parenthesis folds to an unbalanced one) prints `pattern #<n>: folded form invalid` and exits 1 before anything is scanned, never the pattern itself; rewrite that line. This is separate from `pattern #<n>: invalid regular expression`, which still means the raw pattern is broken. Both forms compile up front, and the normalised copy is computed once per file. The same two passes run in `--staged` mode and over PDF text.

On a hit it prints `<file>: pattern #<n>` and fails; it never prints the matched text. With no patterns it passes with a warning annotation, so the workflow works before the secret exists.

Locally, put the same patterns in `.confidential-patterns` at the repo root (gitignored, never commit it) and run `npm run build && npm run gate` before pushing. `CONFIDENTIAL_PATTERNS` in the environment takes precedence over the file; a blank or whitespace-only value falls back to the file. The tracked `.confidential-patterns.example` documents the format with invented tokens only. Start a local file from it without overwriting an existing one: `cp -n .confidential-patterns.example .confidential-patterns`. Each active pattern in the example hides one character in a class (`ab[c]def` matches `abcdef` but not its own source line), so the example never trips the gate on itself; `tests/gate.test.mjs` runs the file fallback, the env-precedence rule and the example itself in temp fixtures, never touching a local `.confidential-patterns`.

Before committing, check what is staged: `git add <paths>` then `npm run gate -- --staged` (`node scripts/gate.mjs --staged`). This mode reads the git index, not the working tree: for every staged added, copied, modified, renamed or type-changed regular file it scans the index blob, so a partial `git add -p` is judged on what will actually be committed, and a token staged and then deleted from disk still fails. Scope is every staged path, not only `dist/`, `src/` and `docs/`, and no `dist/` is needed. Symlinks, gitlinks (submodule entries) and deleted paths are skipped, as are the same binary extensions and NUL-containing blobs as the default mode; a staged `.pdf` is read as a PDF. Patterns follow the same rules (`CONFIDENTIAL_PATTERNS` first, then `.confidential-patterns`), but the file is read from the repository top level, so it works from a subdirectory; in a linked worktree that means the worktree's own top level, so copy the file there. A hit prints `<repo-relative path>: pattern #<n>` on one line, with control characters in the path escaped, never the matched text; as above, a path can itself reveal a name. Nothing staged exits 0 with a one-line message; no patterns warns loudly and exits 0; an invalid regex or running outside a git work tree exits 1. Run with no argument, the gate is unchanged. In a linked worktree the lookup continues one step further (#127), see the pre-commit hook below. A pre-commit hook runs this automatically.

<a id="pre-commit-hook"></a>
**Pre-commit hook (#127).** `.githooks/pre-commit` is a tracked POSIX `sh` script with no dependencies (mode `100755`). It runs `node scripts/gate.mjs --staged` and exits with the gate's code, so a hit rejects the commit. It finds the gate relative to the hook file, not the current directory, leaves git's environment alone (so `git commit -a` and `git commit <path>`, which stage into a temporary `GIT_INDEX_FILE`, are checked on what they will commit) and sets no gate variable, `GATE_REQUIRED` included. It installs itself: `package.json` has one `prepare` script, `node scripts/install-hooks.mjs`, which runs on `npm ci` and `npm install` and sets `core.hooksPath` to `.githooks`; `npm run prepare` installs it by hand. The installer always exits 0, does nothing under `CI` or outside a git work tree, and when `core.hooksPath` already points elsewhere it warns and leaves it alone (the hook is then not installed). `tests/pre-commit-hook.test.mjs` and `tests/install-hooks.test.mjs` cover it with temp repos and synthetic tokens.

- **No patterns, commit allowed.** Locally `GATE_REQUIRED` is unset, so with no patterns the gate warns loudly and exits 0; a contributor without the pattern file can still commit, and CI stays the enforcing gate.
- **Node missing, commit allowed (decision).** If `node` is not on `PATH` (a GUI git client, a non-nvm shell) the hook prints a one-line warning to stderr and lets the commit through. A hook that blocks every commit from such a client gets bypassed and then forgotten, so it fails open and says so.
- **Linked worktrees.** `--staged` looks for patterns in this order and takes the first source that yields any: env `CONFIDENTIAL_PATTERNS`; `.confidential-patterns` at the repository top level; then `.confidential-patterns` at the main worktree root. The last step applies only when the git common dir (`git rev-parse --path-format=absolute --git-common-dir`) is exactly `<root>/.git`, the repository is not bare and `<root>` is not the current top level. A bare repo, a separate git dir, an unusual `GIT_DIR` or a failing `rev-parse` gets no fallback and no guess: the usual no-patterns warning (which then says the main worktree was also checked) and exit 0. The default no-argument mode still reads only the current directory. The lookup lives in the gate, so `npm run gate -- --staged` behaves the same by hand.
- **Caveats.** `core.hooksPath` is shared repository config, so one install switches it for every worktree. A worktree checked out from a commit before this change has no `.githooks/pre-commit`, and git silently skips the hook there until it is rebased. Setting `core.hooksPath` also replaces any untracked hooks in `.git/hooks`.
- **`--no-verify`.** `git commit --no-verify` skips the hook. It exists for humans only; agents never use it.

Dependabot (`.github/dependabot.yml`, #162) opens version-update PRs for npm and for GitHub Actions, weekly, grouped: at most one npm PR (minor and patch updates together; a major opens its own PR) and one Actions PR a week. A `cooldown` of 7 days means a release must be a week old before it is proposed. Those PRs get no secret, so the [confidentiality gate](#confidentiality-gate) only warns on them; they still go through normal review. `tests/action-pins.test.mjs` reads `.github/` from source and locks the config.

### Lighthouse budget

`npm run lhci` (`lhci autorun`, config in `lighthouserc.json`) serves `dist/` locally and audits `/`, `/cv/`, `/work/mts-hub/`, `/work/pearse-dev/` (the page with source excerpts, so Shiki's token contrast is audited) and `/writing/why-i-rebuilt-pearse-dev/` three times each (median asserted) with the default mobile preset. Budgets, each an `error` that fails the PR: performance 0.9 or more, accessibility 1.0, best practices 0.95 or more, SEO 1.0, and cumulative layout shift 0.02 or less (`cumulative-layout-shift`, #153; the key is the bare audit id, since lhci splits keys on `:`). The URL list is hard-coded: bump the article URL when a new article is published. Lighthouse runs on pull requests, pushes to `master` and manual dispatches, but not on the daily scheduled rebuild (#154): that run publishes date-gated content rather than new code, and a score just under budget on one morning would block that day's article and the social posts that wait for it. The trade-off: a date-gated article that goes live on schedule was absent from the PR-time `dist/`, so Lighthouse never audited it, and the scheduled run does not audit newly published pages. That check stays with the PR that bumps the article URL; run the Check workflow by manual dispatch to audit a newly published page on demand. Run locally with `npm run build && npm run lhci` (set `CHROME_PATH` if Chrome is not found). Reports land in `.lighthouseci/` (gitignored); CI uploads them as the `lighthouse-report` artefact, kept 7 days, even on failure (`include-hidden-files` is needed because `.lighthouseci` is a dot-directory). Order in CI: check, build, hash, link crawl, Lighthouse (not on `schedule`), smoke, a11y, `npm run test:ci` (no rebuild), gate, hash verify, Pages upload. Lighthouse's 1.0 accessibility budget stays on its URLs above; axe (see Accessibility scan) covers every page.

### Browser smoke run

Every other check reads `dist/` as text. `npm run smoke` (`scripts/smoke/smoke.mjs`) drives the built site in headless Chrome through `playwright-core` (no browser download) and fails on what a visitor would see. It serves `dist/` with a small `node:http` server on `127.0.0.1`, visits every URL in `dist/sitemap-0.xml` plus every redirect page (any page with a meta refresh), and prints both counts. External requests never leave the machine: images get a 1x1 PNG, everything else is aborted. It runs sequentially in one browser:

- **Console:** on every sitemap URL, a console error, an uncaught page error, a failed same-origin request or a same-origin response of 400 or more fails. Console warnings fail too, except a short commented allowlist of software-WebGL noise (warnings only, never errors).
- **Transitions:** from `/`, each primary Nav link. A skipped cross-document view transition fails, and at least one hop must report `done` (the summary prints the count).
- **Redirects:** from `/`, an in-page navigation into each redirect page, then its target within 10 s. The page must be revealed with a view transition that finishes before the 1 s meta refresh leaves (#55, #79), with the console clean on both hops. Redirect pages are only ever named `redirect #n -> <target>`: no screenshot is taken on them, and their old paths are scrubbed from every message.
- **Overflow:** at 360 and 320 px, after `document.fonts` has loaded, no sitemap URL may scroll sideways. A failure names the path, the width and the widest offending element.
- **Hero:** `/?nogl`, `/?reduce` and `/`, each waiting on `data-hero-ready` (see Motion and degraded paths).

Run it locally with `npm run build && npm run smoke`. Chrome comes from `findChrome()` (`CHROME_PATH`, then `google-chrome`, `chromium` or `chromium-browser` on `PATH`); without one it fails and asks for `CHROME_PATH`. It launches with `--no-sandbox` and SwiftShader, so CI gets software WebGL. `npm run smoke:self` runs it against the fixture in `scripts/smoke/fixture/` (a page that throws, a 400 px element, a clean page) and checks that it fails for exactly those. Neither is part of `npm test`. On failure the run writes `.smoke/report.json` and screenshots (gitignored); CI uploads `.smoke/` as the `smoke-report` artefact, kept 7 days, only when the job fails. Every wait names its signal and has a timeout; there are no fixed sleeps.

### Accessibility scan

Lighthouse audits accessibility on a handful of URLs with its own subset of axe rules. `npm run a11y` (`scripts/smoke/a11y.mjs`, #151) runs the full axe rule set from `@axe-core/playwright` (an exact-pinned devDependency; its axe-core is the one it brings, and its peer is the `playwright-core` the smoke run already uses, so no browser download) over every page a visitor can reach, and any violation fails the run.

- **What is scanned:** every `<loc>` in `dist/sitemap-0.xml`, the 404 page (a made-up path, HTTP 404 asserted) and `/?nogl` (the poster hero). Each URL is scanned at 390x844 and 1440x900, plain viewports (device scale factor 1, no touch emulation). The runner counts the scans from the sitemap and prints the number; posts publish by date, so nothing hardcodes it. Redirect pages are not in the sitemap and are never scanned or named.
- **Reduced motion:** every context emulates `prefers-reduced-motion: reduce`. GSAP's scroll reveals hold below-fold `[data-reveal]` items at opacity 0 until they scroll into view, and GSAP tweens are not Web Animations, so without the emulation axe skips that content as hidden or catches it mid-tween and the contrast results flake. Under reduce the GSAP block never runs and the CSS stops the marquee and the letter reveal, so axe sees the settled page. Default-motion behaviour is the smoke run's job.
- **Settling:** before each scan the runner waits for `load`, `document.fonts.ready`, `data-hero-ready` on `/` and `/?nogl`, then for the page's finite Web Animations, capped at 5 s. Looping animations (the home marquee, the diagram flow edges) are skipped on purpose: they never finish, so waiting on every animation would hang. There are no fixed sleeps.
- **Rules:** axe tags `wcag2a`, `wcag2aa` and `best-practice`. `wcag22aa` (`target-size`) stays off until #105. The run scans everything, reports every violation (rule id, impact, selectors, help URL) and exits 1 at the end. `incomplete` results (needs review) never fail the run; the summary counts them per rule. The summary prints the scan count, the violation count, the incomplete count and the elapsed seconds.
- **Exclusions:** `scripts/smoke/a11y-exclusions.mjs` lists `{ rule, selector, issue: '#NNN', reason }` entries. The runner drops a violation node only when its rule matches and the node is the selector or inside it. It never switches a rule off, and it refuses `html`, `body`, `main` and `*`. An entry that matches nothing in a full run fails the run as `unused exclusion`, so the list cannot go stale; delete the entry in the PR that fixes its issue. Every entry names an open issue (`^#\d+$`, checked by the self-test).
- **Run it:** `npm run build && npm run a11y`. Chrome comes from `findChrome()`: set `CHROME_PATH` if it is not found. The JSON report (an `incomplete` array per scan) goes to `.smoke/a11y/` (gitignored); CI uploads `.smoke/` as the `smoke-report` artefact on failure, kept 7 days. `npm run a11y:self` runs the scan against `scripts/smoke/a11y-fixture/` (an image without alt, a low-contrast paragraph and an unguarded infinite animation) and checks that it fails for both rules at both viewports, finishes, honours exclusions and fails on an unused one. Neither is part of `npm test`.

The smoke run and the scan share `scripts/smoke/harness.mjs` (sitemap discovery, the Chrome lookup and launch, the external-request stub) and `scripts/smoke/server.mjs`.

### DNS and mail check

The only contact route on the site is the domain's own mailbox, so a spoofed or hijacked domain could phish recruiters and clients in Pearse's name. `npm run dns` (`scripts/dns-check.mjs`, #161) is a read-only check of the posture the domain should have. It fetches the live answers with global `fetch` only (no dependencies): DNS over HTTPS JSON from a validating public resolver (`dns.google`, with `cd` unset, never `dig` or `node:dns`, which cannot show the AD flag), a plain HTTPS GET of the MTA-STS policy file (redirects not followed), and RDAP, whose base URL for the TLD comes from the IANA bootstrap file. It hands them to the pure `evaluate(policy, observations)` in `scripts/dns-policy.mjs`, which returns one result per check:

| id | asserts |
|---|---|
| `spf` | exactly one `v=spf1` TXT record at the apex, ending in `-all` |
| `dkim` | `<DKIM_SELECTOR>._domainkey` TXT has `v=DKIM1` and a non-empty `p=` |
| `dmarc` | exactly one `_dmarc` TXT record, with `p=reject` and at least one `rua=mailto:` |
| `mta-sts-record` | exactly one `_mta-sts` TXT record, with `v=STSv1` and an `id=` |
| `mta-sts-policy` | the HTTPS policy file has `version: STSv1`, `mode: enforce`, `max_age` at or above `MTA_STS_MIN_MAX_AGE` (one week) and at least one `mx:` line |
| `caa` | at least one CAA `issue` record at the apex, and every `issue`/`issuewild` CA is in `CAA_ISSUERS` |
| `dnssec-ds` | the parent zone publishes a DS record |
| `dnssec-ad` | the validating resolver answers the apex SOA with `AD: true` |
| `rdap-lock` | RDAP status includes `client transfer prohibited` |
| `rdap-expiry` | the RDAP `expiration` event is more than `EXPIRY_WINDOW_DAYS` (30) away |

Output is one line per check, `<id> <STATUS> <reason>`. Reasons are property-level only (`p=quarantine, want reject`, `2 SPF records`, `1 CAA issuer not in allowlist`) and never echo record data: no mailbox, MX host, key or policy text. Statuses: `PASS`; `FAIL`, an answer came back and it is wrong (a SERVFAIL that survives the retry is a `FAIL`, because it is what visitors' validating resolvers see for bogus DNSSEC, and so is a TLS failure on the MTA-STS host); `ERROR`, the transport failed after one retry (network error, timeout, HTTP 5xx) or an answer could not be parsed (a CAA answer in RFC 3597 `\#` form), so the check could not be evaluated; `PENDING`, see below. Every request has a 10 s timeout and one retry after a short backoff. Exit codes: 0 when every non-pending check passes, 1 on any non-pending `FAIL`, 2 on a non-pending `ERROR` with no `FAIL`.

**Pending.** `PENDING` in `scripts/dns-policy.mjs` lists the checks whose DNS, registrar or mail-provider step Pearse has not finished yet. A pending check is still evaluated and prints its would-be result, `PENDING (would PASS: remove flag)` or `PENDING (would FAIL: <reason>)`, but never affects the exit code. Remove the ID from `PENDING` once the step is done and `npm run dns` shows it would pass: a one-line diff. It started as exactly the checks that did not pass on the first run; `dkim` stays pending until the real selector replaces the `DKIM_SELECTOR` placeholder, and `caa` until `CAA_ISSUERS` is confirmed against every CA the edge and Pages use, renewals included. An unknown ID in `PENDING` throws, so a typo cannot silently disable a check.

**Schedule.** `.github/workflows/dns.yml` runs `npm run dns` every Monday, by `workflow_dispatch`, and on pull requests that touch `scripts/dns-*.mjs`, `tests/dns-policy.test.mjs` or the workflow itself. It has `contents: read` only, uses no secrets and needs no `npm ci`. It is never called from `check.yml` or `deploy.yml`: its result depends on the live network and must not block unrelated pull requests or the daily deploy (ADR 0003). A failed scheduled run emails whoever last changed the cron line, so keep that edit a human one. GitHub disables scheduled workflows after 60 days without repository activity, and the keepalive workflow (#100) does not re-enable this one, so a push to `master` at least every 60 days keeps it alive; a missing weekly run is also a failure signal. `tests/dns-policy.test.mjs` covers the policy with synthetic fixtures, the transport against a stubbed fetch and the workflow's shape, with no network and no `dist/`.

### Security

- **Workflow rules.** `tests/workflow-policy.test.mjs` runs every file in `.github/workflows/` through the pure `check()` in `tests/lib/workflow-policy.mjs`, which fails on: no top-level `permissions:` block; `permissions: write-all` at workflow or job level; a job with `secrets: inherit`; an `actions/checkout` step without `with.persist-credentials: false`. Named write scopes (`pages: write`, `id-token: write`, `actions: write`) are allowed. Fixture cases in the same file prove each rule can fail.
- **Workflow scanners (#146).** Two report-only scanners feed GitHub code scanning; neither blocks a merge, and findings appear as code-scanning alerts (Security tab) and as annotations on the pull request. `.github/workflows/zizmor.yml` runs zizmor at one exact version (`pipx run --spec zizmor==1.31.1`, never `latest`) in online mode with the workflow token at the default severity, on pull requests that touch `.github/**`, weekly and by `workflow_dispatch`; it writes SARIF to the runner's temp directory and uploads it with `codeql-action/upload-sarif` under the `zizmor` category, and the job fails only when zizmor itself errors (`--no-exit-codes`). `.github/workflows/codeql.yml` is CodeQL advanced setup for `actions` and `javascript-typescript` (`build-mode: none`), on pull requests and pushes to `master` that touch `.github/**` or JS/TS source, weekly and by hand. Default setup must stay off (`gh api repos/pearsedarcy/pearse.dev/code-scanning/default-setup --jq .state` prints `not-configured`), because it conflicts with the advanced workflow. One help-level zizmor finding is expected and stays visible: `self-repository` on the deploy workflow's local `./.github/workflows/check.yml` reference, which is left as is because the daily deploy depends on it (ADR 0003). Run zizmor locally with `uvx zizmor@1.31.1 .github/` (`GH_TOKEN=$(gh auth token)` for online mode). Dependabot pull requests (the weekly `github-actions` group touches `.github/**`) start with a read-only token, but GitHub applies a job's explicit `permissions:` to them, so both scanners keep `security-events: write` there; check the first Dependabot Actions PR after merge, and if its upload is refused anyway, skip the upload for `dependabot[bot]` rather than widening permissions. A pull request from a fork gets a read-only token whatever the workflow asks for, so its upload step can fail: that red is the upload, not a finding, and the weekly run still reports.
- **Pinning rule.** Every third-party `uses:`, step or job level, is pinned to a full 40-character commit SHA with the exact release in a trailing comment (`@<sha> # v4.39.3`); local `./` references are exempt. Resolve the commit, not the tag object: `git ls-remote --tags https://github.com/<owner>/<repo> 'refs/tags/vX.Y.Z*'` and take the `^{}` line when there is one (an annotated tag), otherwise the plain line. `tests/workflows.test.mjs` enforces the rule on every file in `.github/workflows/`, with `persist-credentials: false` on every checkout and no `secrets: inherit`, and locks the scanners' triggers, permissions and report-only shape; its fixtures prove a tag pin, a short SHA, a missing comment, a persisting checkout and `secrets: inherit` each fail. A new third-party action must arrive SHA-pinned or this test fails.
- **Read-only default token.** The repository's default `GITHUB_TOKEN` is `read` and Actions may not create or approve pull requests, so a new workflow must declare every permission it needs. Read both settings back with `gh api repos/pearsedarcy/pearse.dev/actions/permissions/workflow` (expect `"default_workflow_permissions":"read"` and `"can_approve_pull_request_reviews":false`) and turn on private vulnerability reporting, then check it, with `gh api repos/pearsedarcy/pearse.dev/private-vulnerability-reporting` (expect `{"enabled":true}`). Both settings are changed with `gh api -X PUT` on the same paths and need admin.
- **Reporting.** `SECURITY.md` is the policy GitHub shows; `public/.well-known/security.txt` (RFC 9116) is served at `/.well-known/security.txt`. `tests/security-txt.test.mjs` checks `dist/` against `SITE.email`, `SITE.repo` and `SITE.url`, so a change to the site config fails until the static file is updated.
- **Renew `Expires` before it passes.** The test fails once `Expires` is in the past or more than 366 days out, and prints a `::warning::` annotation for the last 60 days. The test runs inside the check job the daily deploy needs, so after the date passes the check job fails and scheduled posts stop going live (ADR 0003). Land a PR that bumps `Expires` (about eleven months ahead) before then.

## Requirements

Node 22.23.4 or newer (`.nvmrc`). Astro 7 refuses older 22.x builds, including the 22.23.3 that GitHub-hosted runners cache under a bare `22`, which is why the workflow pins the patch version.

## Deploy

`.github/workflows/deploy.yml` runs on every push to `master`, on the daily schedule, and on manual dispatch. It has two jobs and builds nothing itself. `check` calls `check.yml`, which builds `dist/` once, checks it (including the confidentiality gate) and uploads it as the run's `github-pages` artifact. `deploy` needs `check` and publishes that artifact with `actions/deploy-pages`, so what goes live is the build that was gated. `deploy` runs only on `refs/heads/master`, because the `github-pages` environment accepts only `master`: a dispatch on another branch runs `check` and its upload, then skips `deploy`. The repository's Pages source must be set to **GitHub Actions**. `public/CNAME` keeps the custom domain; `site` is `https://pearse.dev` with no `base`. The build runs with `CI` set and devDependencies installed, so the CV PDF is printed there too (the `ubuntu-24.04` runner image ships Chrome; without it the build fails).

Every action is pinned to a full commit SHA with a trailing `# vX.Y.Z` comment, and every job with steps runs on `ubuntu-24.04` instead of `ubuntu-latest` (the reusable-workflow `check` job in `deploy.yml` has no `runs-on`). `tests/action-pins.test.mjs` enforces both, and the repository setting `sha_pinning_required` makes GitHub refuse an unpinned action. To bump an action, prefer the weekly Dependabot PR. To bump by hand, resolve the commit SHA of the tag (not the tag object, which differs for annotated tags) with `gh api repos/<owner>/<repo>/commits/<tag> -q .sha`, then write `uses: <owner>/<repo>@<sha> # <tag>`.

Every Check run, so every deploy (push, the daily rebuild, manual dispatch) and every pull request, writes a **publishing runway** to its step summary. The step runs `npm run runway` right after `npm ci` with `continue-on-error: true`: it reports and never gates or changes what is published. The table lists every article, standalone post and visible case study with a `social` block by UTC date (on one date: articles, then standalone posts, then case studies), with its state and its count of fields that still hold a verify marker (the body counts once; 0 exactly when the publish check passes). An article is `draft` when `draft: true`, `live` once published, otherwise `scheduled`; a standalone post is `draft` unless `approved`, then `live` on or after its date and `scheduled` before it; a case study is `live` or `scheduled` by `social.date`. Live rows from before the current ISO week are left out. Below the table: the runway end (the last live or scheduled article) and the empty weeks from this week to the last article, drafts included. Each draft dated within 7 days or overdue gets a `::warning title=Runway::` annotation. The output names ids, kinds, states, dates and counts only, never titles, copy, notes or body text, because the summary of this public repository is public; pending client case studies are left out entirely. Run `npm run runway` for a local view, with `RUNWAY_NOW=2026-11-01` to fix the date.

`.github/workflows/keepalive.yml` runs weekly (and on manual dispatch) with `actions: write` only. It checks out and commits nothing; it calls the API to re-enable `deploy.yml` and itself, so GitHub's 60-day inactivity cutoff does not silence the daily rebuild. This depends on the enable call resetting the inactivity counter, which GitHub does not document. If it does not, a push to `master` at least every 60 days keeps the schedules alive regardless.

## Docs

- **Decisions:** [`docs/adr/`](docs/adr/) (0001 to 0007) and [`GLOSSARY.md`](GLOSSARY.md).
- **Agent entry point:** [`CLAUDE.md`](CLAUDE.md) (house rules for agents, linking to the docs above).
- **Content checklists:** [`docs/content-checklists.md`](docs/content-checklists.md) (add a case study, an article or a standalone post, rename or fold a case study; each step names what enforces it, or says it is not enforced). `tests/content-checklists.test.mjs` fails when a path or registry it names disappears.
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md).
- **Profile copy:** [`docs/profile/linkedin.md`](docs/profile/linkedin.md) (LinkedIn headline, About, Experience, Featured, Skills, paste order) and [`docs/profile/bio.md`](docs/profile/bio.md) (50, 100 and 300-word speaker bios), derived from the case studies.

## Licence

Code is MIT (see `LICENSE`). Written content under `src/content/` is © Pearse D'Arcy.
