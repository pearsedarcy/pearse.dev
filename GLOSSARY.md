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

**Contact block**:
The close of every visible case study, after "Writing about this project" and before Previous/Next: a mailto titled "About <project>" in one of three variants. `private` offers a walkthrough call and links nothing, `repo` links the public repository, `public` is the mailto alone (#103, PR #177).
_Enforced by_: `src/lib/contact.ts` picks the variant; `tests/case-contact.test.mjs`.
_Avoid_: CTA, enquiry form

**How the job ran**:
The method block on a client case study, after the body and sections: two or more of five canonical steps (audit, staging, gated, cutover, written-down), in that order, each with one sentence of proof from the same page. The promise text is shared and never overridden per entry (#160, PR #226).
_Enforced by_: `src/lib/process.ts` and the `process` field in `src/content.config.ts`.
_Avoid_: process section, methodology

**Poster**:
The build-time SVG that stands in for a 3D scene (the hero icosahedron, the About-section stack). Every visitor gets it first; only a capable, motion-tolerant desktop visitor gets the scene on top. With reduced motion, Save-Data, a narrow viewport, no WebGL or `?lite`, the poster stays and three.js is never fetched (ADR 0010).
_Enforced by_: `sceneMode()` in `src/lib/scene-gate.ts`.
_Avoid_: fallback image, placeholder

**Article**:
A long-form post under Writing with a title, description, publication date and tags. May reference one case study.
_Avoid_: blog post, entry

**Publication date**:
The date an article is meant to go live. Articles are compared against this date at build time (the build clock), in UTC.
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

**Build clock**:
The "now" every publishing decision is made against (ADR 0014): the real clock, or the date in `SITE_NOW` when it is set, which builds and tests the site as it will look on that date. A deploy never sets it; the ahead build (`.github/workflows/ahead.yml`, #344) sets it to the next scheduled article's date, or today + 14 days when none is scheduled, and builds and tests but never deploys or uploads. Facts about the build itself, such as when the GitHub data was fetched, read the real clock.
_Enforced by_: `src/lib/clock.ts` (`siteNow()` and `wallNow()`) and `tests/clock.test.mjs`, which bans any other clock read in the publishing code and any mention of `SITE_NOW` in a workflow other than `ahead.yml`; `src/lib/ahead.ts` and `tests/ahead.test.mjs` for the ahead date and the workflow's shape.
_Avoid_: build date, fake clock

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
One of four content themes every piece of social copy and every post tag belongs to: Platform building (Django), Self-hosted AI in production, Agentic engineering, Career. Career was added with the closed tag vocabulary (#166, PR #216).
_Enforced by_: `PILLARS` in `src/lib/tags.ts`.
_Avoid_: topic, theme, category

**Tag**:
One of a closed list of seven post tags, each in exactly one pillar: `django`, `architecture`, `migration` and `privacy` (Platform building), `self-hosted-ai`, `agentic-engineering`, `career`. An unknown tag fails the build; adding one is a code change (ADR 0009).
_Enforced by_: `TAG_PILLAR` in `src/lib/tags.ts` and the posts schema; `tests/post-tags.test.mjs`.
_Avoid_: keyword, label, category

**Approval**:
The human step where Pearse says yes to a specific piece of social copy before it is posted. Nothing is posted without it.
_Avoid_: sign-off, review

**Scheduler**:
The automation that reads the social feed, asks for approval, posts approved copy to the networks at the planned time, and records what it posted.
_Avoid_: bot, poster, automation

**Kill switch**:
The one way to pause the Scheduler: set the `DRY_RUN` n8n variable to `true`. Nothing is posted while it is set; offers keep arriving labelled DRY RUN and a Skip tapped meanwhile goes to the separate dry-run record. Deactivating the workflow is not the kill switch, because it also kills the buttons on open offers (ADR 0008).
_Avoid_: pause button, stop switch

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

**Confidentiality gate**:
The check that fails when any tracked file or path, or any file under `dist/`, matches a confidential pattern, or, with `--staged`, a staged file does (ADR 0005). With `GATE_REQUIRED=1`, as on every deploy, it also fails closed when it has no patterns or too few. Run as `npm run gate` in CI, and over the staged files by the pre-commit hook in `.githooks/`.
_Enforced by_: `scripts/gate.mjs`.
_Avoid_: secret scan, linter

**Outcome (engineering metrics only)**:
A case study's above-the-fold proof: an optional one-sentence `outcome` with no digits, and an optional `outcomes` row of one to four value-and-label metrics. Engineering metrics only (tests, decision records), never money, percentages or business counts, and every figure restates one already in that page's own copy, or computed at build from this repository's own checkout. Business figures are **Confidential**.
_Avoid_: KPI, result, impact numbers

**Figure**:
A headline count about one of the three tracked products (MTS Hub, wetlabs.app, pearse.dev): ADRs, tests, test files or commits, kept once in the figure table (`src/lib/figures.ts`) with the month it was measured and how (ADR 0018). A count in the copy is either a claim against a figure, which must agree with it ("about", "more than" and a bare number each have a rule), or an ignored count with a reason; `tests/figures.test.mjs` fails on any other. MTS figures are counts only and name nothing **Confidential**. pearse.dev's ADR figure is counted from `docs/adr/` and is never summed into an MTS figure.
_Avoid_: stat, number, metric (for this sense)

**Client case study**:
A case study about work for a paying client rather than for MTS. Needs the client's permission before it is published under their name.

**Client quote**:
A client's own words about the work, one optional `quote` on a client case study, attributed by role and organisation type or domain, never by personal name. Its `permission` defaults to `pending`, which never renders; the quote is committed only once the client grants it (`permission: granted`), and a declined or unanswered quote has no entry at all, so the two look the same (ADR 0015).
_Enforced by_: `src/lib/quotes.ts`; only a granted quote on a visible case study renders.
_Avoid_: testimonial, review

**Asset budget**:
The most bytes one built asset may weigh: the three.js and motion chunks and each page's eager JavaScript (gzipped), each font family and each class of Open Graph card (raw). A heavier asset fails `npm test`; raising a budget is a reviewed one-line change with the new measurement beside it (ADR 0017).
_Enforced by_: the `BUDGETS` table in `tests/asset-budgets.test.mjs`.
_Avoid_: performance budget (that is the Lighthouse score), size limit
