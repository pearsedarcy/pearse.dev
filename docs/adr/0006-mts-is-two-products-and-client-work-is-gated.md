---
status: accepted
date: 2026-10-28
---

# MTS is two products on this site, and client work is published only with permission

The site presents MTS as exactly two case studies, MTS Hub and wetlabs.app. The smaller tools that grew up beside them (packing, feedback reports, drafting, the knowledge base, observability) are feature sections inside those two, described by what they do and never by their old names. The old URLs of the retired case studies stay alive as static redirects. We rejected one case study per internal tool because it made one engineer's employer look like a portfolio of unrelated products, and rejected deleting the old URLs because they had already been shared.

Client case studies (`category: client`) are hidden everywhere until `clientPermission` is `granted` or `anonymised`; `pending` is the default, so forgetting the flag fails closed. Written permission has now been given for all four client case studies, which are published as written. The flag stays in the schema for the next client.

Private source briefs (writing, design and research notes used to draft content) live outside the repository on the author's machine, like the confidentiality denylist (ADR 0005). Nothing in the repository links to them or names where they are kept.

## Consequences

- A new internal tool becomes a `sections` entry on one of the two case studies, not a case study. Renaming or folding a case study means adding its old slug to `MOVED_CASE_STUDIES` in `astro.config.mjs`.
- `tests/mts-products.test.mjs` and `tests/visibility.test.mjs` hold both rules, so a regression fails `npm test`.
- Granting permission is a one-line frontmatter change, but a granted case study still names no owner or staff member, server, price or business figure.
- MTS repositories are private. Case studies say "Private repository" and never link.
