import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    oneLiner: z.string(),
    period: z.string(),
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
  }),
});

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()),
    project: z.string().optional(),
    draft: z.boolean().default(false),
    social: z.object({
      linkedin: z.string(),
      short: z.string(),
    }),
  }),
});

const now = defineCollection({
  loader: glob({ base: './src/content/now', pattern: '**/*.md' }),
  schema: z.object({
    updated: z.coerce.date(),
  }),
});

// Standalone posts: social copy with no article (ADR 0002). Body = LinkedIn copy.
// Generated from the legacy JSON by scripts/migrate-standalone.mjs; edit the files directly once it is gone.
const PILLARS = ['Platform building (Django)', 'Self-hosted AI in production', 'Agentic engineering'] as const;

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
  }),
});

export const collections = { projects, posts, now, social };
