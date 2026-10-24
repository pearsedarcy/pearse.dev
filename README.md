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

Drafts are excluded everywhere. Posts dated in the future are excluded from the HTML pages and RSS until their `pubDate`; the deploy workflow rebuilds every Monday at 06:00 UTC so they go live on schedule.

### Social feed

`/social.json` lists every non-draft post, including scheduled ones, oldest first:

```json
[{ "slug": "…", "title": "…", "url": "https://pearse.dev/writing/…/", "pubDate": "2026-11-03", "tags": ["…"], "social": { "linkedin": "…", "short": "…" } }]
```

An n8n workflow reads it to schedule posts. `/rss.xml` carries the published posts.

## Motion and degraded paths

- `prefers-reduced-motion: reduce` — the hero and stack render one static frame; no loops, no pointer reaction; the marquee and letter reveal stop.
- No WebGL — the SVG posters stay in place.
- Force either path for testing with `?reduce` or `?nogl` on any URL.

## Checks

`.github/workflows/check.yml` runs on every pull request and is called by the deploy workflow, whose `build` job needs it green. It runs `npm ci`, `astro check`, the build, the link crawl, `npm test` and the confidentiality gate.

The gate (`scripts/gate.mjs`, ADR 0005) scans `dist/`, `src/` and `docs/` case-insensitively for patterns that must never ship. Patterns come from the repository secret `CONFIDENTIAL_PATTERNS`: one regular expression per line (case-insensitive, multiline: `^`/`$` match per line), blank lines and `#` comments ignored. Every file is scanned except known binary types and files containing a NUL byte. The `#n` in the output counts patterns (non-empty, non-comment lines), not file lines. The printed path can itself reveal a name, so keep sensitive words out of filenames. Fork and Dependabot PRs receive no secret and so only get the warning. A missing `dist/` fails the gate: build first. On a hit it prints `<file>: pattern #<n>` and fails; it never prints the matched text. With no patterns it passes with a warning annotation, so the workflow works before the secret exists.

Locally, put the same patterns in `.confidential-patterns` at the repo root (gitignored, never commit it) and run `npm run build && npm run gate` before pushing. `CONFIDENTIAL_PATTERNS` in the environment takes precedence over the file.

## Requirements

Node 22.23.4 or newer (`.nvmrc`). Astro 7 refuses older 22.x builds, including the 22.23.3 that GitHub-hosted runners cache under a bare `22`, which is why the workflow pins the patch version.

## Deploy

`.github/workflows/deploy.yml` builds with `withastro/action` and publishes with `actions/deploy-pages` on every push to `master`, on the daily schedule, and on manual dispatch. The repository's Pages source must be set to **GitHub Actions**. `public/CNAME` keeps the custom domain; `site` is `https://pearse.dev` with no `base`.

## Docs

- **Profile copy:** [`docs/profile/linkedin.md`](docs/profile/linkedin.md) (LinkedIn headline, About, Experience, Featured, Skills, paste order) and [`docs/profile/bio.md`](docs/profile/bio.md) (50, 100 and 300-word speaker bios), derived from the case studies.

## Licence

Code is MIT (see `LICENSE`). Written content under `src/content/` is © Pearse D'Arcy.
