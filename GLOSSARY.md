# pearse.dev

The personal site and the publishing pipeline behind it: case studies, articles, and the social copy that promotes them. One context; the site is the source of truth for everything that gets posted elsewhere.

## Language

### Content

**Case study**:
A page describing one project: what it is, the period, the role, the stack, what it does, and two or three things worth knowing. Lives under Work.
_Avoid_: project page, portfolio item

**Smaller build**:
A project too short for a case study (`smallerBuild: true`): one row in the Smaller builds list on /work/, with no page or number of its own (ADR 0007).
_Avoid_: mini case study, minor project

**Skill**:
A technology or practice on /stack/, backed by at least one visible case study's stack (a section stack counts). Its count is case studies, not years; the map from stack strings to skills lives in `src/lib/site.ts`.
_Avoid_: tech, tool, competency

**Article**:
A long-form post under Writing with a title, description, publication date and tags. May reference one case study.
_Avoid_: blog post, entry

**Publication date**:
The date an article is meant to go live. Articles are compared against this date at build time, in UTC.
_Avoid_: publish date, release date

**Draft**:
An article withheld from the site and from the social feed regardless of its publication date, usually because it still carries verify markers.

**Scheduled**:
A non-draft article whose publication date is still in the future. It has no page yet. It appears in the social feed by id and date only, marked as not published, with no title or copy until the rebuild on its date.

**Published**:
A non-draft article whose publication date has passed as of the most recent rebuild. It has a page, is in the RSS feed, the sitemap and the Writing index.

**Series**:
An ordered run of articles about one product (MTS Hub or wetlabs.app), set by `series` and `seriesOrder`. Each published part shows "Part n of m" and links the other published parts; scheduled and draft parts are neither listed nor counted.
_Enforced by_: `src/lib/series.ts`.

**Rebuild**:
The daily automated build and deploy that promotes scheduled articles to published on their date. No content changes are needed to trigger it.

**Verify marker**:
An inline placeholder of the form `[VERIFY: …]` left by a ghost-writer where a fact was not confirmed. Content with a verify marker is never approved.
_Enforced by_: `src/lib/verify-marker.ts`, the only definition of the marker; the build fails on any published content that still has one.

### Social

**Social copy**:
The ready-to-post text attached to an article: a LinkedIn variant and a short variant for character-limited networks. Written with the article, stored with the article.
_Avoid_: social post, snippet, caption

**Standalone post**:
Social copy that is not attached to any article. Has its own date, pillar and format, and the same approval rules.
_Avoid_: filler post, loose post

**Social feed**:
The machine-readable list of every non-draft article and every approved standalone post, with its social copy and published flag (a scheduled article is listed by id and date only, with no copy until it is published), served at `/social.json`. The only input the scheduler reads.

**Pillar**:
One of three content themes every piece of social copy belongs to: platform building, self-hosted AI in production, agentic engineering.
_Avoid_: topic, theme, category

**Approval**:
The human step where Pearse says yes to a specific piece of social copy before it is posted. Nothing is posted without it.
_Avoid_: sign-off, review

**Scheduler**:
The automation that reads the social feed, asks for approval, posts approved copy to the networks at the planned time, and records what it posted.
_Avoid_: bot, poster, automation

**Runway**:
The planned publishing calendar: every article, standalone post and case study with social copy, by date and state (draft, scheduled, live), with its count of fields that still hold a verify marker. Reported in each CI run's step summary; it reports and never gates.
_Enforced by_: `src/lib/runway.ts` and `npm run runway` (`scripts/runway.mjs`).
_Avoid_: schedule, calendar, backlog

**Empty week**:
An ISO week (Monday to Sunday, UTC, named by its Monday) on the runway with no article in any state, drafts included. Standalone posts and case studies do not fill it.

**Posting record**:
The scheduler's log of what was posted where and when, used to avoid posting the same copy twice.
_Avoid_: dedup log, history

### Boundaries

**Confidential**:
Anything in the content inventory's confidentiality list: infrastructure addresses, credentials, customer and congress names, business figures, security internals. Confidential material never appears in the repository or on the site, and the list itself is kept outside the repository.

**Outcome (engineering metrics only)**:
A case study's above-the-fold proof: an optional one-sentence `outcome` with no digits, and an optional `outcomes` row of one to four value-and-label metrics. Engineering metrics only (tests, decision records), never money, percentages or business counts, and every figure restates one already in that page's own copy, or computed at build from this repository's own checkout. Business figures are **Confidential**.
_Avoid_: KPI, result, impact numbers

**Client case study**:
A case study about work for a paying client rather than for MTS. Needs the client's permission before it is published under their name.

**Client quote**:
A client's own words about the work, one optional `quote` on a client case study, attributed by role and organisation type or domain, never by personal name. Committed only once the client grants it; a declined or unanswered quote has no entry at all, so the two look the same.
_Enforced by_: `src/lib/quotes.ts`; only a granted quote on a visible case study renders.
_Avoid_: testimonial, review
