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
---
Optional notes in Markdown, rendered under the facts.
```

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

## Requirements

Node 22.23.4 or newer (`.nvmrc`). Astro 7 refuses older 22.x builds, including the 22.23.3 that GitHub-hosted runners cache under a bare `22`, which is why the workflow pins the patch version.

## Deploy

`.github/workflows/deploy.yml` builds with `withastro/action` and publishes with `actions/deploy-pages` on every push to `master`, on the daily schedule, and on manual dispatch. The repository's Pages source must be set to **GitHub Actions**. `public/CNAME` keeps the custom domain; `site` is `https://pearse.dev` with no `base`.

## Docs

- **Profile copy:** [`docs/profile/linkedin.md`](docs/profile/linkedin.md) (LinkedIn headline, About, Experience, Featured, Skills, paste order) and [`docs/profile/bio.md`](docs/profile/bio.md) (50, 100 and 300-word speaker bios), derived from the case studies.

## Licence

Code is MIT (see `LICENSE`). Written content under `src/content/` is © Pearse D'Arcy.
