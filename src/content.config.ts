import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { DIAGRAM_NAMES } from './lib/diagrams';
import { EXCERPT_IDS } from './lib/excerpts';
import { PILLARS, POST_TAGS } from './lib/tags';
import { publishBlockers } from './lib/verify-marker';
import { META_DESCRIPTION_MAX, metaDescriptionLength } from './lib/seo';
import { refineSeries, seriesFields } from './lib/series';
import { PROCESS_STEP_IDS, processIssues } from './lib/process';
import { OUTCOME_LABEL_MAX, OUTCOME_MAX, OUTCOME_VALUE_MAX, OUTCOMES_MAX, OUTCOMES_MIN, outcomeIssues } from './lib/outcomes';
import { QUOTE_PERMISSIONS, validateQuote } from './lib/quotes';
import { buildFactsIssues } from './lib/build-facts';

const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    // The visible lede on the case-study page. Also the meta description unless `description` is set.
    oneLiner: z.string(),
    // Meta description, for a case study whose oneLiner is too long for one (#134).
    description: z.string().optional(),
    // Above-the-fold proof (#159, src/lib/outcomes.ts): one before/after sentence with no digits,
    // and a row of 1 to 4 engineering metrics, each restating a figure already in this page's copy.
    // The caps are declared here for a clear error; the other rules run in the superRefine below.
    outcome: z.string().max(OUTCOME_MAX).optional(),
    outcomes: z
      .array(z.object({ value: z.string().max(OUTCOME_VALUE_MAX), label: z.string().max(OUTCOME_LABEL_MAX) }))
      .min(OUTCOMES_MIN)
      .max(OUTCOMES_MAX)
      .optional(),
    // Opt in to the computed outcomes row and colophon paragraph (#287, src/lib/build-facts.ts):
    // figures read from this repository's own checkout at build. Only an entry whose repo is this
    // site's repository may set it, and never together with a hand-written outcomes row.
    buildFacts: z.boolean().default(false),
    // An ongoing period is "<start with a four-digit year> – Present" (en dash, single spaces),
    // so the CV's start-only display and the /work/ start-year parser keep their year.
    period: z.string().refine((v) => !/present/i.test(v) || /^(?:[A-Z][a-z]{2} )?(?:19|20)\d{2} – Present$/.test(v), {
      message: 'an ongoing period must read "Mon YYYY – Present" or "YYYY – Present"',
    }),
    role: z.string().default('Sole engineer'),
    stack: z.array(z.string()),
    featured: z.boolean().default(false),
    order: z.number().int(),
    features: z.array(z.string()),
    hooks: z.array(z.string()),
    repo: z.string().url().optional(),
    live: z.string().url().optional(),
    visibility: z.enum(['public', 'private']),
    category: z.enum(['mts', 'client', 'tool', 'learning']),
    // Only meaningful for category 'client'; 'pending' hides the case study everywhere.
    clientPermission: z.enum(['pending', 'granted', 'anonymised']).default('pending'),
    // One client quote (#279, src/lib/quotes.ts), client case studies only. Commit only granted
    // text: there is no `declined`, and a declined or unanswered quote has no entry at all.
    // `permission` defaults to 'pending', which renders nothing (fail-closed); strict, so no
    // extra key (a name, a status note) can ride along. validateQuote runs in the superRefine below.
    quote: z
      .object({
        text: z.string(),
        attribution: z.string(),
        permission: z.enum(QUOTE_PERMISSIONS).default('pending'),
      })
      .strict()
      .optional(),
    // A short build that is a row in the /work/ "Smaller builds" list, not a numbered case study
    // with its own page (ADR 0007). Its body, features and hooks are kept but not rendered.
    smallerBuild: z.boolean().default(false),
    // Names an architecture diagram component in src/components/diagrams/.
    diagram: z.enum(DIAGRAM_NAMES).optional(),
    // Social copy for the case study (ADR 0002). With it, a visible case study is a
    // `project` entry in /social.json on `date`; without it, the case study is not in the feed.
    social: z
      .object({
        date: z.coerce.date(),
        linkedin: z.string(),
        short: z.string().max(300),
      })
      .optional(),
    // Feature sections: parts of the product that once stood alone (e.g. a tool folded into
    // MTS Hub). Each renders as a "what it does" subsection with an anchor at #<id>.
    sections: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]+$/),
          title: z.string(),
          // Where the part came from, e.g. "Began as a standalone packing tool in Feb 2026". Describe the
          // feature, never a product name: MTS is two products (issue #39)..
          origin: z.string().optional(),
          summary: z.string(),
          features: z.array(z.string()).min(1),
          stack: z.array(z.string()).default([]),
          diagram: z.enum(DIAGRAM_NAMES).optional(),
        }),
      )
      .default([])
      .superRefine((sections, ctx) => {
        const seen = new Set<string>();
        sections.forEach((s, i) => {
          if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate section id "${s.id}"` });
          seen.add(s.id);
        });
      }),
    // Source excerpts (#152): ids from src/lib/excerpts.ts, rendered in this order as "Code from this
    // repo". Only the pure id tuple is imported here, never the raw-source registry.
    excerpts: z
      .array(z.enum(EXCERPT_IDS))
      .default([])
      .superRefine((ids, ctx) => {
        const seen = new Set<string>();
        ids.forEach((id, i) => {
          if (seen.has(id)) ctx.addIssue({ code: 'custom', path: [i], message: `duplicate excerpt id "${id}"` });
          seen.add(id);
        });
      }),
    // "How the job ran" (src/lib/process.ts): the canonical steps this page backs, in order, each
    // with one sentence of proof from this page. The promise text is shared; client case studies only.
    process: z
      .array(
        z.object({
          step: z.enum(PROCESS_STEP_IDS),
          proof: z.string().max(160),
        }),
      )
      .default([])
      .superRefine((steps, ctx) => {
        for (const { index, message } of processIssues(steps)) {
          ctx.addIssue({ code: 'custom', path: [index, 'step'], message });
        }
      }),
  }).superRefine((d, ctx) => {
    // Engineering metrics only: no money, %, verify marker, business count or digit in the sentence (#159).
    for (const { path, message } of outcomeIssues({ outcome: d.outcome, outcomes: d.outcomes })) {
      ctx.addIssue({ code: 'custom', path: path.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k)), message: `"${d.slug}": ${message}` });
    }
    for (const { path, message } of buildFactsIssues(d)) {
      ctx.addIssue({ code: 'custom', path: [path], message: `"${d.slug}": ${message}` });
    }
    // The process block states a client job's method; no other category may carry one (#160).
    if (d.category !== 'client' && d.process.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['process'], message: `"${d.slug}": process is for client case studies only` });
    }
    // A quote is validated whatever its permission, so a malformed block fails before it renders (#279).
    if (d.quote) {
      for (const { path, message } of validateQuote(d.quote, d)) {
        ctx.addIssue({ code: 'custom', path: path.split('.'), message: `"${d.slug}": ${message}` });
      }
    }
    // The page's meta description is `description ?? oneLiner`; the shared rule caps it (#134).
    const n = metaDescriptionLength(d.description ?? d.oneLiner);
    if (n > META_DESCRIPTION_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: [d.description === undefined ? 'oneLiner' : 'description'],
        message: `"${d.slug}": meta description is ${n} chars, max ${META_DESCRIPTION_MAX}`,
      });
    }
  }),
});

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(META_DESCRIPTION_MAX),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    // Closed vocabulary (src/lib/tags.ts): an unknown tag fails the build.
    tags: z.array(z.enum(POST_TAGS)).min(1),
    project: z.string().optional(),
    draft: z.boolean().default(false),
    // Optional article series (src/lib/series.ts): both `series` and `seriesOrder`, or neither.
    // Duplicate orders within a series are caught across entries by validateSeries at build time.
    ...seriesFields,
    social: z.object({
      linkedin: z.string(),
      short: z.string().max(300),
    }),
  }).superRefine(refineSeries),
});

const now = defineCollection({
  loader: glob({ base: './src/content/now', pattern: '**/*.md' }),
  schema: z.object({
    updated: z.coerce.date(),
  }),
});

// Standalone posts: social copy with no article (ADR 0002). Body = LinkedIn copy.
// The first twelve were migrated from a JSON file by scripts/migrate-standalone.mjs; the files are now the source of truth.
const social = defineCollection({
  loader: glob({ base: './src/content/social', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    pillar: z.enum(PILLARS),
    format: z.string(),
    visual: z.string().default('none'),
    // draft: never in the social feed. approved: in the feed, even when dated in the future.
    status: z.enum(['draft', 'approved']).default('draft'),
    short: z.string().max(300),
    note: z.string().optional(),
  }).superRefine((d, ctx) => {
    // Fail fast on an approved post with a verify marker in its frontmatter. Only an early
    // warning: buildFeed (assertPublishable) is the guarantee, and it checks the body too.
    if (d.status !== 'approved') return;
    for (const path of publishBlockers('standalone', d, '')) {
      ctx.addIssue({ code: 'custom', path: path.split('.'), message: `approved standalone post still has a verify marker in ${path}` });
    }
  }),
});

// CV facts that live nowhere else on the site. Everything else on /cv/ comes from
// SITE, INTERESTS, the projects collection and MARQUEE. Wording follows docs/profile/.
const entry = z.object({
  title: z.string(),
  organisation: z.string(),
  period: z.string(),
  location: z.string().optional(),
  summary: z.string().optional(),
  bullets: z.array(z.string()),
  // The entry's row on the home Timeline (#168), read by src/lib/timeline.ts. Required, so no
  // CV entry can be left off the Timeline. Not the CV's top-level `headline`: that one introduces
  // the whole CV, this one is a single Timeline row's line. `now` marks the one current row; it
  // is a flag, not "the period ends Present", and exactly one entry sets it. /cv/ renders neither.
  timeline: z.object({ headline: z.string(), now: z.boolean().optional() }),
  // A job's products, each with its own bullets, rendered as sub-headings under the job.
  // MTS is exactly two products (issue #39); folded tools are bullets under them, never products.
  // A product with `timeline` is also a sub-item of its job's Timeline row.
  products: z
    .array(
      z.object({
        name: z.string(),
        summary: z.string().optional(),
        bullets: z.array(z.string()).min(1),
        timeline: z.object({ headline: z.string() }).optional(),
      }),
    )
    .default([]),
});

const cv = defineCollection({
  loader: glob({ base: './src/content/cv', pattern: '**/*.md' }),
  schema: z.object({
    // The "Updated <Month YYYY>" stamp on /cv/ and its PDF (#289). Required, so a missing date
    // fails the build. Bump it whenever this file changes: tests/cv-updated.test.mjs fails when
    // its month is earlier than the month of cv.md's last commit (author date).
    updated: z.coerce.date(),
    headline: z.string(),
    experience: z.array(entry),
    education: z.array(entry),
    // "Before software": the skating career, rendered after Education.
    before: z.array(entry).default([]),
    // Optional on purpose: the section only renders once a language list is confirmed.
    languages: z.array(z.object({ language: z.string(), level: z.string() })).default([]),
    // Home Timeline rows that are not CV entries (#168). /cv/ does not render them. `sortYear`
    // orders a period with no four-digit year and is never a real year (the repo is public).
    milestones: z
      .array(
        z.object({
          period: z.string(),
          context: z.string(),
          href: z.string().optional(),
          headline: z.string(),
          sortYear: z.number().int().optional(),
        }),
      )
      .default([]),
  }),
});

export const collections = { projects, posts, now, social, cv };
