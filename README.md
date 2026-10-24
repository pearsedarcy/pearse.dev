# pearse.dev

Personal site of Pearse D'Arcy. Static, built with [Astro](https://astro.build) 7, Tailwind CSS v4 and a small amount of Three.js. Deployed to GitHub Pages at <https://pearse.dev>.

## Stack

- **Astro 7** — static output, content collections, `@astrojs/rss`, `@astrojs/sitemap`
- **Tailwind v4** via `@tailwindcss/vite`, configured in CSS (`src/styles/global.css`, `@theme` block) with `@tailwindcss/typography` for prose
- **Three.js** (tree-shaken) — hero icosahedron and the About-section stack object, loaded after first paint
- **GSAP** core + ScrollTrigger + SplitText — scroll reveals, loaded on idle
- **Fonts** — Archivo (display, expanded), Inter (body), JetBrains Mono (labels), self-hosted from `@fontsource-variable/*`, latin subset only

Node 22 or newer (`.nvmrc` / `engines`).

## Commands

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # -> dist/
npm run preview    # serve dist/
npm run check      # astro check (types + content schema)
npm run links      # verify every internal link in dist/ resolves
npm run gate       # confidentiality gate (see Checks)
npm test           # node:test suites under tests/
npm run og         # regenerate public/og-default.png with headless Chrome
npm run og:pages   # render per-page cards to public/og/ (also runs as prebuild)
```

## Content

Everything editorial is Markdown in `src/content/`, validated by the schemas in `src/content.config.ts`. A missing or mistyped field fails the build.

### Add a project

Create `src/content/projects/<slug>.md`:

```yaml
---
title: Project name
slug: project-name          # used in /work/<slug>/
oneLiner: One sentence, what it is and for whom.
period: Jan – Mar 2026
role: Sole engineer         # optional, defaults to "Sole engineer"
stack: [Django 5, PostgreSQL]
featured: true              # home page shows the first six featured, by order
order: 7                    # sort key everywhere
features: ["…", "…"]
hooks: ["…", "…"]           # 2–3 pull-quote facts
repo: https://github.com/…  # optional; omit for private work
live: https://…             # optional
visibility: private         # private | public
category: mts               # mts | client | tool | learning
clientPermission: pending   # client case studies only; pending | granted | anonymised (default pending)
---
Optional notes in Markdown, rendered under the facts.
```

`clientPermission` gates **client case studies** (`category: client`) and is ignored for every other category.

| Value | Meaning |
|---|---|
| `pending` (default) | No permission yet. The case study is excluded from the home grid, `/work/`, its own page, the sitemap, "next" links and writing-post project links. |
| `granted` | Client agreed to be named. Published as written. |
| `anonymised` | Client agreed on condition of anonymity. Published; the copy must already be anonymised. |

Set the value explicitly on every client case study. `tests/visibility.test.mjs` asserts that `pending` ones are absent from the build.

Private repositories show "Private repository" and never link.

### Add a post

Create `src/content/posts/<slug>.md`. The filename is the URL: `/writing/<slug>/`.

```yaml
---
title: Post title
description: ≤155 characters, used as the meta description.
pubDate: 2026-11-03
updatedDate: 2026-11-10     # optional
tags: [django, agents]
project: mts-hub            # optional, a project slug; links the post and the case study
draft: false
social:
  linkedin: |
    Long-form LinkedIn version, first line is the hook.
  short: "≤280 chars incl. URL, for X/Bluesky/Mastodon."
---
```

Drafts are excluded everywhere. Posts dated in the future are excluded from the HTML pages and RSS until their `pubDate`; the deploy workflow rebuilds every day at 06:00 UTC so they go live on their date.

### Social feed

`/social.json` lists every non-draft article (including scheduled ones) and every approved standalone post, oldest first. Each entry has a `kind`:

```json
[
  { "kind": "article", "id": "…", "slug": "…", "title": "…", "date": "2026-11-03", "pubDate": "2026-11-03",
    "url": "https://pearse.dev/writing/…/", "published": false, "status": "approved", "tags": ["…"],
    "social": { "linkedin": "…", "short": "…" } },
  { "kind": "standalone", "id": "p01", "title": "…", "date": "2026-11-04", "pillar": "Agentic engineering",
    "format": "Short lesson", "visual": "none", "published": true, "status": "approved",
    "social": { "linkedin": "…", "short": "…" } }
]
```

Articles keep their original fields (`slug`, `pubDate`, `url`, `tags`); `id` and `date` are the same values under the shared names. `published` is false for a scheduled article until its page exists, so the scheduler must never link early. Standalone posts have no page and no `url`, and are always `published: true`.

An n8n workflow reads it to schedule posts. `/rss.xml` carries the published posts.

### Add a standalone post

A standalone post is social copy with no article. Add `src/content/social/<id>.md`; the filename is the id (lowercase, e.g. `p13.md`):

```md
---
title: "Write the rule as a hook, not a sentence"
date: 2026-11-04                 # the day it should go out (UTC)
pillar: "Agentic engineering"    # Platform building (Django) | Self-hosted AI in production | Agentic engineering
format: "Short lesson"           # free text: Short lesson, How we do X, Before/after, …
visual: "none"                   # what to attach, or "none"
status: draft                    # draft | approved
short: "≤300 chars incl. URL, for X/Bluesky/Mastodon. https://pearse.dev"
note: "optional reviewer note"   # optional, not in the feed
---

The LinkedIn copy is the body, first line is the hook.
```

- `draft` (the default) is never in the social feed. Resolve every `[VERIFY: …]` marker before approving: the build fails on an approved post with a marker left in its title, short copy or body.
- `approved` is in the feed straight away, even when dated in the future, so the scheduler can plan around its `date`. The scheduler still asks for a human approve before sending anything (ADR 0004).

The collection is the source of truth: edit the Markdown directly. The first twelve were migrated from a JSON file that has since been deleted; `scripts/migrate-standalone.mjs` is kept only as the record of that migration and must not be re-run.

### Now page

`/now/` renders `src/content/now/now.md`. To update it, edit the file and bump `updated` in the frontmatter; the page shows it as "Updated <Month YYYY>". Keep it public-safe (see ADR 0005).

## Open Graph images

Every article and visible case study page gets its own 1200x630 card at `/og/<slug>.png`: the title in Archivo, a mono kicker (date and reading time for an article, order, category and period for a case study), the icosahedron mark and `pearse.dev` above the lime bar. Home, index and 404 pages keep `public/og-default.png`, which is committed and regenerated by hand with `npm run og`.

- `scripts/og-pages.mjs` renders the cards with headless Chrome, not satori, because the Archivo width axis only renders faithfully in a browser. It runs as `prebuild`, so `npm run build` (and `withastro/action` on deploy) always regenerates them; `npm run og:pages` runs it alone. Four renders run in parallel, about 2 s for the current pages.
- `public/og/` is generated and gitignored. The script empties it first, so a post that goes back to draft loses its card.
- Which pages get a card follows `src/lib/visibility.ts`, the same publish and visibility rules the pages use: drafts, future-dated articles and `pending` client case studies get none.
- Chrome comes from `CHROME_PATH`, then `google-chrome`, `chromium` or `chromium-browser` on `PATH`. Without one the script warns and every page falls back to the default image, so a local build never fails on it; under `CI` it fails instead. `src/lib/og.ts` picks the page card only when its file exists.
- `og:image:alt` (and `twitter:image:alt`) reads `<Title>, Pearse D’Arcy, pearse.dev`; `twitter:image` mirrors `og:image`.
- `tests/og.test.mjs` checks one distinct card per page, each a real PNG over 10 KB, none for drafts or pending client case studies, and the default on every other page. It skips the image assertions when the build had no Chrome (`.astro/og-pages.json` records the run).

## Motion and degraded paths

- `prefers-reduced-motion: reduce` — the hero and stack render one static frame; no loops, no pointer reaction; the marquee and letter reveal stop.
- No WebGL — the SVG posters stay in place.
- Force either path for testing with `?reduce` or `?nogl` on any URL.

## Checks

`.github/workflows/check.yml` runs on every pull request and is called by the deploy workflow, whose `build` job needs it green. It runs `npm ci`, `astro check`, the build, the link crawl, the Lighthouse budget, `npm test` and the confidentiality gate.

The gate (`scripts/gate.mjs`, ADR 0005) scans `dist/`, `src/` and `docs/` case-insensitively for patterns that must never ship. Patterns come from the repository secret `CONFIDENTIAL_PATTERNS`: one regular expression per line (case-insensitive, multiline: `^`/`$` match per line), blank lines and `#` comments ignored. Every file is scanned except known binary types and files containing a NUL byte. The `#n` in the output counts patterns (non-empty, non-comment lines), not file lines. The printed path can itself reveal a name, so keep sensitive words out of filenames. Fork and Dependabot PRs receive no secret and so only get the warning. A missing `dist/` fails the gate: build first. On a hit it prints `<file>: pattern #<n>` and fails; it never prints the matched text. With no patterns it passes with a warning annotation, so the workflow works before the secret exists.

Locally, put the same patterns in `.confidential-patterns` at the repo root (gitignored, never commit it) and run `npm run build && npm run gate` before pushing. `CONFIDENTIAL_PATTERNS` in the environment takes precedence over the file.

### Lighthouse budget

`npm run lhci` (`lhci autorun`, config in `lighthouserc.json`) serves `dist/` locally and audits `/`, `/work/mts-hub/` and `/writing/why-i-rebuilt-pearse-dev/` three times each (median asserted) with the default mobile preset. Budgets, each an `error` that fails the PR: performance 0.9 or more, accessibility 1.0, best practices 0.95 or more, SEO 1.0. The URL list is hard-coded: bump the article URL when a new article is published. Run locally with `npm run build && npm run lhci` (set `CHROME_PATH` if Chrome is not found). Reports land in `.lighthouseci/` (gitignored); CI uploads them as the `lighthouse-report` artefact, kept 7 days, even on failure (`include-hidden-files` is needed because `.lighthouseci` is a dot-directory). Order in CI: check, build, link crawl, Lighthouse, then `npm test` (which rebuilds `dist` via `pretest`).

## Requirements

Node 22.23.4 or newer (`.nvmrc`). Astro 7 refuses older 22.x builds, including the 22.23.3 that GitHub-hosted runners cache under a bare `22`, which is why the workflow pins the patch version.

## Deploy

`.github/workflows/deploy.yml` builds with `withastro/action` and publishes with `actions/deploy-pages` on every push to `master`, on the daily schedule, and on manual dispatch. The repository's Pages source must be set to **GitHub Actions**. `public/CNAME` keeps the custom domain; `site` is `https://pearse.dev` with no `base`.

## Docs

- **Profile copy:** [`docs/profile/linkedin.md`](docs/profile/linkedin.md) (LinkedIn headline, About, Experience, Featured, Skills, paste order) and [`docs/profile/bio.md`](docs/profile/bio.md) (50, 100 and 300-word speaker bios), derived from the case studies.

## Licence

Code is MIT (see `LICENSE`). Written content under `src/content/` is © Pearse D'Arcy.
