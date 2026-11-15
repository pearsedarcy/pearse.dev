---
status: accepted
date: 2026-11-15
---

# Client quotes render only from a granted entry

ADR 0006 publishes a client case study only once the client has given permission. A client's own words are a second, separate grant: a client can agree to a case study and not to being quoted, and a quote typed into a Markdown file by hand would ship with the next deploy whether or not anyone had cleared it. Before #279 (PR #309) the site had no place for a quote at all.

Decision: **a client case study takes one optional `quote` (`text`, `attribution`, `permission`), and it renders only when `permission` is `granted`, the entry is a case study with a page, and validation passes.** `permission` defaults to `pending`, so a forgotten flag fails closed, as `clientPermission` does. There is no `declined` value: a declined or unanswered quote has no entry, so the repository never records who said no. `validateQuote` in `src/lib/quotes.ts` runs from the schema on every quote whatever its permission, so a malformed block fails the build before it could ever render; its messages never repeat the quote. Attribution is by role and organisation type or domain, never a personal name. We rejected committing pending quotes ahead of the grant, because the words would then sit in a public repository before the client agreed to them, and rejected markup with Review or Rating structured data, because a quote is not a rating and the site does not mark up its own work as reviewed.

## Consequences

- `tests/quotes.test.mjs` fails on any committed `quote` whose permission is not `granted`. Pending is a value for a working copy, never for `master`.
- A smaller build has no page, so it never shows a quote, even a granted one.
- A granted quote shows on its case study, and in work order on the home "From clients" aside and on `/cv/`, each of which shows at most two. Two long quotes push the CV PDF to a third page, which `tests/cv.test.mjs` fails on; the case-study checklist says so.
- A granted quote follows the same limits as the rest of a client case study: no owner or staff name, server, price or business figure (ADR 0006).
- The site shipped with the field and no quotes; `dist/` has no `data-client-quote` element until a grant is committed.
