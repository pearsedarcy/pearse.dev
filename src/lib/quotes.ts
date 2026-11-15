// Client quotes (GLOSSARY "Client quote", #279): the optional `quote` on a client case study,
// its validation and the fail-closed selection the pages render from. Pure: the schema
// (src/content.config.ts), the pages and the tests (Node type stripping) all load it, so imports
// carry explicit `.ts` extensions, there are no enums and nothing here may import astro:content.
// Kept out of the `visibility-rules` excerpt in src/lib/visibility.ts on purpose, so the
// published source excerpt does not change.
import { VERIFY_MARKER } from './verify-marker.ts';
import { isCaseStudy } from './visibility.ts';
import { compareWork } from './work-order.ts';

/**
 * The permission values. There is deliberately no `declined`: a declined or unanswered quote is
 * absent from frontmatter, so declined and no-reply look the same in a public, permanent history.
 */
export const QUOTE_PERMISSIONS = ['pending', 'granted'] as const;
export type QuotePermission = (typeof QUOTE_PERMISSIONS)[number];

/** Max characters in a quote's `text`. */
export const QUOTE_TEXT_MAX = 240;
/** Max characters in a quote's `attribution`. */
export const QUOTE_ATTRIBUTION_MAX = 60;
/** The only attribution allowed on a case study with `clientPermission: anonymised`. */
export const ANONYMISED_ATTRIBUTION = 'Client, website project';
/** How many quotes the home page and /cv/ show at most. */
export const FEATURED_QUOTES_MAX = 2;

export interface Quote {
  /** The client's words exactly, one paragraph. */
  text: string;
  /** "<Role>, <organisation type or domain>"; never a personal name (a human check). */
  attribution: string;
  /** Absent means `pending`: nothing renders. */
  permission?: QuotePermission;
}

/** The frontmatter the quote rules read. */
export interface QuoteProject {
  category: string;
  clientPermission?: string;
  smallerBuild?: boolean;
  quote?: Quote;
}

/** One rule broken: `path` is dotted (`quote.text`); `message` names the rule, never the text. */
export interface QuoteIssue {
  path: string;
  message: string;
}

const LINE_BREAK = /[\r\n\u2028\u2029]/;
// "<Role>, <rest>": exactly one comma, followed by one space, both parts non-empty and unpadded.
const ATTRIBUTION = /^[^,\s](?:[^,]*[^,\s])?, [^,\s](?:[^,]*[^,\s])?$/;

/**
 * Every rule a `quote` breaks on `project`. Runs whatever the `permission`, so a malformed block
 * fails the build before it would ever render. Messages never echo the quote, so a failing build
 * log does not repeat words that may not be cleared for publishing.
 */
export function validateQuote(quote: Quote, project: { category: string; clientPermission?: string }): QuoteIssue[] {
  const issues: QuoteIssue[] = [];
  if (project.category !== 'client') {
    issues.push({ path: 'quote', message: 'quote is for client case studies only' });
  }
  const { text, attribution } = quote;
  if (typeof text !== 'string' || text.trim().length === 0) {
    issues.push({ path: 'quote.text', message: 'quote.text is empty' });
  } else {
    if (text.length > QUOTE_TEXT_MAX) issues.push({ path: 'quote.text', message: `quote.text: ${text.length} characters, max ${QUOTE_TEXT_MAX}` });
    if (LINE_BREAK.test(text)) issues.push({ path: 'quote.text', message: 'quote.text: one paragraph, no line breaks' });
    if (text.includes(VERIFY_MARKER)) issues.push({ path: 'quote.text', message: 'quote.text: still has a verify marker; resolve it first' });
  }
  if (typeof attribution !== 'string') {
    issues.push({ path: 'quote.attribution', message: 'quote.attribution is missing' });
  } else {
    if (attribution.length > QUOTE_ATTRIBUTION_MAX) {
      issues.push({ path: 'quote.attribution', message: `quote.attribution: ${attribution.length} characters, max ${QUOTE_ATTRIBUTION_MAX}` });
    }
    if (!ATTRIBUTION.test(attribution) || LINE_BREAK.test(attribution)) {
      issues.push({ path: 'quote.attribution', message: 'quote.attribution must read "<Role>, <organisation type or domain>", with exactly one comma' });
    }
    if (attribution.includes(VERIFY_MARKER)) {
      issues.push({ path: 'quote.attribution', message: 'quote.attribution: still has a verify marker; resolve it first' });
    }
    if (project.clientPermission === 'anonymised' && attribution !== ANONYMISED_ATTRIBUTION) {
      issues.push({ path: 'quote.attribution', message: `quote.attribution on an anonymised case study must be exactly "${ANONYMISED_ATTRIBUTION}"` });
    }
  }
  return issues;
}

/**
 * The quote a case study renders, or undefined. Fail-closed: only a valid quote with
 * `permission: granted` on a visible case study with a page (isCaseStudy, which includes
 * isVisibleProject) renders. A pending or absent permission, a pending client case study, a
 * smaller build (no page to show it on) or an invalid block all give undefined.
 */
export function caseStudyQuote(project: QuoteProject): Quote | undefined {
  const quote = project.quote;
  if (!quote || quote.permission !== 'granted') return undefined;
  if (!isCaseStudy(project)) return undefined;
  if (validateQuote(quote, project).length > 0) return undefined;
  return quote;
}

/** A renderable quote with the case study it belongs to. */
export interface FeaturedQuote<T> {
  project: T;
  quote: Quote;
}

/**
 * Up to `max` renderable quotes (caseStudyQuote) in /work/ order (compareWork): never the home
 * grid's featured-first selection and never `order` alone. The home page and /cv/ both use it.
 */
export function featuredQuotes<T extends QuoteProject & { order: number; slug: string }>(
  projects: readonly T[],
  max = FEATURED_QUOTES_MAX,
): FeaturedQuote<T>[] {
  return projects
    .flatMap((project) => {
      const quote = caseStudyQuote(project);
      return quote ? [{ project, quote }] : [];
    })
    .sort((a, b) => compareWork(a.project, b.project))
    .slice(0, Math.max(0, max));
}
