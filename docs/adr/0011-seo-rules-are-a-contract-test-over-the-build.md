---
status: accepted
date: 2026-11-01
---

# SEO rules are a contract test over the built site

Three SEO defects had shipped before #134 (PR #220): the 404 page claimed a canonical and `og:url` for a `/404/` URL that does not exist and had no `noindex`; every page said `<html lang="en">` while `og:locale` said `en_GB` and the RSS channel `en-gb`; and six meta descriptions were longer than the 160 characters search results show. Each could have been fixed alone, and each could have come back with the next page.

Decision: **the SEO rules are one contract test, `tests/seo.test.mjs`, that reads only `dist/` and classifies every page from the build itself.** A page with `noindex` and a meta refresh is a redirect page; one with `noindex` and no refresh is a noindex page (today only 404); every other page is indexable. No slug list is imported or hard-coded. Indexable pages need one self canonical, a matching `og:url`, an absolute `og:image` that exists in `dist/`, `lang="en-GB"`, one `<h1>`, a meta description within the shared limit, and JSON-LD that parses. The sitemap must list exactly the indexable pages, and every RSS item must link one. The limit is written once, in `src/lib/seo.ts` (160, counted as the JS string length, as zod's `.max` counts it), and both the content schemas and the test import it. We chose a test over the build instead of checks on the sources because the defects were in what the layout emitted, not in any one content file.

## Consequences

- The shared layout takes a `noindex` prop that drops the canonical and `og:url`; 404 sets it. Case studies take an optional `description`, and the page's meta description is `description ?? oneLiner`, so the visible lede does not change. A description over the limit fails the build at the schema, before the test runs.
- A new kind of page has to fit one of the three kinds, or the test says which rule it breaks.
- Failures name redirect pages by index and refresh target only, never by their old path, because CI logs are public (ADR 0005, ADR 0006).
- The older feature tests that also check sitemap membership (visibility, CV, Now, the draft essay, the redirect stubs) stay as they are; this test is the general contract, not their replacement.
