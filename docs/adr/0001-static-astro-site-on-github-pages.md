---
status: accepted
date: 2026-10-24
---

# Static Astro site on GitHub Pages, not Wagtail

The old site was a static HTML template on GitHub Pages behind Cloudflare, and Wagtail on Django was the first suggestion for the rebuild. We chose Astro with content collections, built by GitHub Actions and deployed to GitHub Pages, because the content is a handful of Markdown files that one person edits in git, and a Django app would add a server, a database, backups and a login to protect for no editorial gain. The 3D hero and the scroll motion are plain script tags on static pages, so no framework island is needed.

## Consequences

- There is no runtime. Anything dynamic (publishing by date, social scheduling) happens at build time or in an external automation that reads the built output.
- Editing content means a commit. That is the intended workflow, not a limitation to fix.
