import { ORIGIN } from './origin.mjs';

export const SITE = {
  name: 'Pearse D’Arcy',
  url: ORIGIN,
  title: 'Pearse D’Arcy — software engineer, Innsbruck',
  description:
    'Software engineer in Innsbruck building Django platforms, self-hosted AI with guardrails, and agent-assisted engineering workflows.',
  email: 'pearse@pearse.dev',
  github: 'https://github.com/pearsedarcy',
  linkedin: 'https://www.linkedin.com/in/pearsedarcy',
  repo: 'https://github.com/pearsedarcy/pearse.dev',
  // Optional profile links, shipped unset (#157). Typed `string | null`: under `as const` a bare
  // `null` would be the literal type `null`, so the "set" branch of every check would be `never`.
  /** Full https profile URL on Mastodon. Rendered in the footer with rel="me" when set. */
  mastodon: null as string | null,
  /** Full https profile URL on bsky.app. Rendered in the footer with rel="me" when set. */
  bluesky: null as string | null,
  /** Bluesky DID (`did:plc:…`), served at /.well-known/atproto-did when set. */
  atprotoDid: null as string | null,
  /**
   * Cloudflare Web Analytics token, shipped unset (#129). It is read by the /privacy/ page, which
   * then adds its analytics paragraph, and by the dist origin test, which then also allows
   * static.cloudflareinsights.com. This field does not render the beacon: #20 adds the script tag.
   */
  analyticsToken: undefined as string | undefined,
  location: 'Innsbruck, Austria',
  ogImage: '/og-default.png',
} as const;

/**
 * The Impressum block (#155). Kept out of `SITE` on purpose: under `as const` an absent key would make
 * `SITE.legal` a type error. Every heading and paragraph on the page comes from here; the page has no
 * wording of its own. There is no email field: the page shows `SITE.email`, like the footer and the
 * home contact block. `legalState()` in `src/lib/legal.ts` classifies it, and only a complete block
 * builds `/impressum/` and its footer link. An incomplete one fails the build. Ships unset; the values
 * arrive only through the human-only follow-up issue.
 */
export interface LegalBlock {
  /** The page <h1>. */
  heading: string;
  /** The name as it should appear on the page. */
  name: string;
  /** Postal address lines, non-empty. */
  address: string[];
  /** Headed paragraphs, non-empty. A blank line in `body` starts a new paragraph. */
  sections: { heading: string; body: string }[];
  /** Optional label/value lines. */
  details?: { label: string; value: string }[];
}

export const LEGAL: LegalBlock | undefined = undefined;

export const NAV = [
  { href: '/work/', label: 'Work' },
  { href: '/writing/', label: 'Writing' },
  { href: '/cv/', label: 'CV' },
  { href: '/#about', label: 'About' },
  { href: '/#contact', label: 'Contact' },
] as const;

/** Words for the marquee under the hero: the real stack, nothing aspirational. */
export const MARQUEE = [
  'Django',
  'PostgreSQL',
  'Celery',
  'HTMX',
  'Tailwind',
  'Three.js',
  'FFmpeg',
  'OpenTelemetry',
  'Ollama',
  'LangGraph',
  'Claude Code',
  'Hetzner',
  'Docker Compose',
  'Wagtail',
  'WebSockets',
];

/**
 * The skills map (#163): what /stack/, the home and CV skill matrices and the marquee links are built
 * from, by src/lib/skill-map.ts. Evidence is the `stack` and `sections[].stack` strings of every case
 * study (isCaseStudy). A skill counts a case study when a stack string equals its `name` or one of its
 * `aliases`, or evidences a skill whose `implies` names it (Django implies Python, #297); one string
 * may evidence several skills. `implies` is only for what is always true of the skill, never a habit
 * of some projects: those go in the case study's stack. `labels` are other words the site uses for a
 * skill (the marquee's) and are never evidence. A skill with no evidence renders nowhere, and a group
 * with no rendered skill disappears: nothing here is padded.
 *
 * List order is the numbered Skills list in docs/profile/linkedin.md (the positioning order), then
 * the skills that are not on it. Display order inside a group is list order, so listed skills keep
 * that list's relative order and come before unlisted ones; the CV shows the first evidenced skills
 * in this order. Every alias and ignore entry must match some case study's stack string, and every stack string
 * must map to a skill or sit on `ignore` (tests/skills.test.mjs).
 */
export const SKILL_GROUPS = ['Backend', 'Data', 'AI/ML', 'Infra/Ops', 'Frontend', 'Practices'] as const;

export interface SkillDef {
  name: string;
  group: (typeof SKILL_GROUPS)[number];
  aliases?: readonly string[];
  labels?: readonly string[];
  implies?: readonly string[];
}

export const SKILLS: readonly SkillDef[] = [
  // On the LinkedIn Skills list, in its order (1 to 36).
  {
    name: 'Django',
    group: 'Backend',
    aliases: [
      'Django 5', // versioned name
      'Django 5.2', // versioned name
      'Django 5.2 LTS', // versioned name
    ],
    implies: ['Python' /* Django is a Python web framework */],
  },
  { name: 'Python', group: 'Backend', aliases: ['Python 3.12' /* versioned name */] },
  { name: 'Agentic workflows', group: 'Practices' },
  {
    name: 'PostgreSQL',
    group: 'Data',
    aliases: [
      'PostgreSQL 16', // versioned name
      'PostgreSQL + pgvector', // PostgreSQL with the pgvector extension
    ],
  },
  { name: 'Celery', group: 'Backend', aliases: ['Celery + Redis' /* Celery with Redis as its broker */] },
  {
    name: 'Self-hosted LLM deployment',
    group: 'AI/ML',
    aliases: [
      'Self-hosted vLLM', // a language model served on own hardware
      'Qwen3-VL via Ollama', // a vision-language model served on own hardware
    ],
  },
  { name: 'Django REST Framework', group: 'Backend', aliases: ['DRF' /* the usual short name */] },
  { name: 'Software architecture', group: 'Practices' },
  { name: 'Architecture decision records', group: 'Practices' },
  {
    name: 'Claude Code',
    group: 'AI/ML',
    aliases: [
      'Claude Code agents', // agents run in Claude Code
      'Claude CLI', // the command-line interface of Claude Code
    ],
  },
  {
    name: 'AI agents',
    group: 'AI/ML',
    aliases: [
      'Claude Code agents', // agents that do the work
      'claude-agent-sdk', // the SDK for building agents
    ],
  },
  { name: 'LangGraph', group: 'AI/ML' },
  { name: 'vLLM', group: 'AI/ML', aliases: ['Self-hosted vLLM' /* vLLM, run on own hardware */] },
  { name: 'Ollama', group: 'AI/ML', aliases: ['Qwen3-VL via Ollama' /* a model served by Ollama */] },
  { name: 'PyTorch', group: 'AI/ML', aliases: ['PyTorch (ResNet50 + MS-TCN++)' /* PyTorch models, named */] },
  {
    name: 'Computer vision',
    group: 'AI/ML',
    aliases: ['PyTorch (ResNet50 + MS-TCN++)' /* image and video-segmentation models */],
  },
  { name: 'FFmpeg', group: 'Backend' },
  { name: 'OpenTelemetry', group: 'Infra/Ops' },
  { name: 'Observability', group: 'Infra/Ops' },
  // The marquee says "Docker Compose", which no stack names: a label resolves the word, it is not evidence.
  { name: 'Docker', group: 'Infra/Ops', labels: ['Docker Compose'] },
  { name: 'Hetzner Cloud', group: 'Infra/Ops', aliases: ['Hetzner' /* the provider's short name */] },
  { name: 'Cloudflare', group: 'Infra/Ops' },
  { name: 'Traefik', group: 'Infra/Ops' },
  { name: 'GitHub Actions', group: 'Infra/Ops', aliases: ['GitHub Actions → GHCR' /* Actions, pushing images */] },
  { name: 'Continuous deployment', group: 'Infra/Ops' },
  { name: 'Redis', group: 'Data', aliases: ['Celery + Redis' /* Redis as Celery's broker */] },
  {
    name: 'WebSockets',
    group: 'Backend',
    aliases: [
      'Django Channels', // Channels is Django's WebSocket layer
      'Channels / Daphne', // Channels on Daphne, its ASGI server: Django's WebSocket layer
    ],
  },
  {
    name: 'HTMX',
    group: 'Frontend',
    aliases: [
      'HTMX + Alpine.js', // HTMX with Alpine.js
      'HTMX + Alpine', // HTMX with Alpine.js
    ],
  },
  {
    name: 'Alpine.js',
    group: 'Frontend',
    aliases: [
      'HTMX + Alpine.js', // Alpine.js with HTMX
      'HTMX + Alpine', // Alpine.js with HTMX
    ],
  },
  {
    name: 'Tailwind CSS',
    group: 'Frontend',
    aliases: [
      'Tailwind v4', // versioned name
      'Tailwind v4 + DaisyUI', // Tailwind with its DaisyUI component plugin
    ],
    labels: ['Tailwind'],
  },
  { name: 'Wagtail', group: 'Backend', aliases: ['Wagtail 8' /* versioned name */] },
  { name: 'Astro', group: 'Frontend', aliases: ['Astro 7' /* versioned name */] },
  { name: 'Three.js', group: 'Frontend' },
  { name: 'Playwright', group: 'Practices', aliases: ['Playwright + axe' /* Playwright, with axe */] },
  { name: 'Web accessibility', group: 'Practices', aliases: ['Playwright + axe' /* axe checks accessibility */] },
  { name: 'GDPR', group: 'Practices' },
  // Not on the LinkedIn list: shown after the listed skills of their group.
  { name: 'WordPress', group: 'Backend', aliases: ['WordPress 7.1' /* versioned name */] },
  { name: 'WooCommerce', group: 'Backend' },
  { name: 'Flask', group: 'Backend' },
  { name: 'FastAPI', group: 'Backend' },
  { name: 'PHP', group: 'Backend', aliases: ['PHP 8.3' /* versioned name */] },
  { name: 'pgvector', group: 'Data', aliases: ['PostgreSQL + pgvector' /* the extension, named */] },
  { name: 'MySQL', group: 'Data', aliases: ['MySQL 8' /* versioned name */] },
  { name: 'MCP', group: 'AI/ML', aliases: ['Basic Memory (MCP)' /* a Model Context Protocol server */] },
  { name: 'nginx', group: 'Infra/Ops', aliases: ['nginx X-Accel-Redirect' /* an nginx feature, named */] },
  { name: 'Apache', group: 'Infra/Ops' },
  { name: 'n8n', group: 'Infra/Ops' },
  {
    name: 'Web Push',
    group: 'Frontend',
    aliases: [
      'Web Push / PWA', // Web Push in an installable web app
      'pywebpush', // the Python library that sends Web Push
    ],
  },
  { name: 'pytest', group: 'Practices' },
];

/** Exact stack strings that are deliberately not skills: small tools, services and libraries. */
export const SKILL_IGNORE: readonly string[] = [
  'Bash + Make',
  'Bash hooks',
  'Blocksy child theme',
  'Brevo',
  'django-unfold',
  'git worktrees',
  'GitHub CLI',
  'GitHub Pages',
  'GlitchTip',
  'Grafana Alloy',
  'Heroku',
  'Mailchimp',
  'matplotlib',
  'MediaMTX (SRT / LL-HLS)',
  'Microsoft 365 calendar',
  'ntfy',
  'OpenObserve',
  'openpyxl',
  'ReportLab',
  'systemd',
  'Tailscale',
  'Telegram Bot API',
  'Typer',
  'UMAP + numpy',
  'WeasyPrint',
  'wp-cli',
];

/** The three parts of the skills map, as src/lib/skill-map.ts takes them. */
export const SKILL_MAP = { groups: SKILL_GROUPS, skills: SKILLS, ignore: SKILL_IGNORE } as const;

/** Life outside work, as one list for the home About section and the CV (issue #42). */
export const INTERESTS = [
  'Downhill mountain biking',
  'Snowboarding',
  'Road biking',
  'Table tennis',
  'Billiards',
  'Gardening',
  'Film and TV',
];

export const CATEGORY_LABEL: Record<string, string> = {
  mts: 'MTS platform',
  client: 'Client work',
  tool: 'Tooling',
  learning: 'Learning',
};

export function formatDate(d: Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    ...opts,
  }).format(d);
}

export function readingTime(body: string): number {
  const words = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`\[\]()!-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function absoluteUrl(path: string): string {
  return new URL(path, SITE.url).toString();
}
