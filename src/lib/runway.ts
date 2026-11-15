// The publishing runway report (GLOSSARY "Runway"): what goes out when, in what state, with how
// many verify-marker fields, and which weeks have no article. Build-time and informational only:
// it never fails a run and never changes what is published. Pure, with no `astro:content` import
// and explicit .ts imports like feed.ts, so node:test and scripts/runway.mjs can load it.
// Output carries ids, kinds, states, dates and counts only: never titles, copy, notes or body text.
import { siteNow } from './clock.ts';
import { isCaseStudy, isPublishedPost } from './visibility.ts';
import { publishBlockers } from './verify-marker.ts';

/** Frontmatter as parsed (YAML gives dates as `YYYY-MM-DD` strings) plus the Markdown body. */
export interface RunwayInput {
  /** The slug: the file name, or a project's `slug` field. */
  id: string;
  data: Readonly<Record<string, unknown>>;
  body: string;
}

export type RunwayKind = 'article' | 'standalone' | 'project';
export type RunwayState = 'draft' | 'scheduled' | 'live';

export interface RunwayRow {
  /** YYYY-MM-DD (UTC). */
  date: string;
  id: string;
  kind: RunwayKind;
  state: RunwayState;
  /** Hit paths of the publish check (publishBlockers): 0 exactly when assertPublishable passes. */
  verifyFields: number;
}

export interface RunwayWarning {
  kind: 'article' | 'standalone';
  id: string;
  /** YYYY-MM-DD (UTC). */
  date: string;
  verifyFields: number;
}

export interface Runway {
  /** YYYY-MM-DD (UTC) of `now`. */
  today: string;
  rows: RunwayRow[];
  /** Mondays (YYYY-MM-DD) of the ISO weeks with no article in any state. */
  emptyWeeks: string[];
  /** Date of the last live or scheduled article, or null when there is none. */
  runwayEnd: string | null;
  warnings: RunwayWarning[];
}

const DAY_MS = 86_400_000;
/** Warn for a draft dated on or before today plus this many days. */
export const WARN_DAYS = 7;
const KIND_ORDER: Record<RunwayKind, number> = { article: 0, standalone: 1, project: 2 };

const day = (d: Date) => d.toISOString().slice(0, 10);

function toDate(value: unknown, what: string): Date {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error(`${what}: no valid date`);
  return d;
}

/** UTC midnight of the Monday of the ISO week that contains `d`. */
export function weekStart(d: Date): Date {
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(midnight - ((d.getUTCDay() + 6) % 7) * DAY_MS);
}

/**
 * The runway at `now`. Article states use isPublishedPost, project inclusion uses isCaseStudy,
 * and the VERIFY count uses publishBlockers, so the report restates none of those rules.
 * Rows run oldest first (articles, then standalone posts, then projects on one date); live rows
 * dated before the ISO week of `now` are left out, everything else (past drafts too) is kept.
 */
export function buildRunway(
  articles: readonly RunwayInput[],
  standalone: readonly RunwayInput[],
  projects: readonly RunwayInput[],
  now = siteNow(),
): Runway {
  const rows: RunwayRow[] = [];

  for (const { id, data, body } of articles) {
    const pubDate = toDate(data.pubDate, `article "${id}" pubDate`);
    const draft = data.draft === true;
    const state: RunwayState = draft ? 'draft' : isPublishedPost({ draft, pubDate }, now) ? 'live' : 'scheduled';
    rows.push({ date: day(pubDate), id, kind: 'article', state, verifyFields: publishBlockers('article', data, body).length });
  }

  for (const { id, data, body } of standalone) {
    const date = toDate(data.date, `standalone "${id}" date`);
    const state: RunwayState =
      data.status !== 'approved' ? 'draft' : date.getTime() <= now.getTime() ? 'live' : 'scheduled';
    rows.push({ date: day(date), id, kind: 'standalone', state, verifyFields: publishBlockers('standalone', data, body).length });
  }

  for (const { id, data, body } of projects) {
    const social = data.social as { date?: unknown } | undefined;
    // A pending client case study, a smaller build or one without social copy is not on the runway.
    if (!social || !isCaseStudy(data as { category: string; clientPermission?: string; smallerBuild?: boolean })) continue;
    const date = toDate(social.date, `project "${id}" social.date`);
    const state: RunwayState = date.getTime() <= now.getTime() ? 'live' : 'scheduled';
    rows.push({ date: day(date), id, kind: 'project', state, verifyFields: publishBlockers('project', data, body).length });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const today = day(now);
  const thisWeek = day(weekStart(now));
  const warnBy = day(new Date(Date.parse(today) + WARN_DAYS * DAY_MS));

  const articleRows = rows.filter((r) => r.kind === 'article');
  const articleWeeks = new Set(articleRows.map((r) => day(weekStart(new Date(r.date)))));
  // Drafts included: they are the planned runway, so their gaps must show.
  const lastArticle = articleRows.at(-1)?.date;
  const emptyWeeks: string[] = [];
  if (lastArticle) {
    const end = Date.parse(day(weekStart(new Date(lastArticle))));
    for (let t = Date.parse(thisWeek); t <= end; t += 7 * DAY_MS) {
      const monday = day(new Date(t));
      if (!articleWeeks.has(monday)) emptyWeeks.push(monday);
    }
  }

  const warnings: RunwayWarning[] = rows
    .filter((r): r is RunwayRow & { kind: 'article' | 'standalone' } => r.kind !== 'project')
    .filter((r) => r.state === 'draft' && r.date <= warnBy)
    .map(({ kind, id, date, verifyFields }) => ({ kind, id, date, verifyFields }));

  return {
    today,
    rows: rows.filter((r) => !(r.state === 'live' && r.date < thisWeek)),
    emptyWeeks,
    runwayEnd: articleRows.filter((r) => r.state !== 'draft').at(-1)?.date ?? null,
    warnings,
  };
}

const fields = (n: number) => `${n} VERIFY field${n === 1 ? '' : 's'}`;

/** One GitHub Actions warning annotation: kind, id, date and VERIFY count only. */
export function warningLine(w: RunwayWarning): string {
  return `::warning title=Runway::${w.kind} ${w.id} ${w.date} (${fields(w.verifyFields)})`;
}

/** The Markdown step summary: a heading, the runway end, the table, the empty weeks and the warning count. */
export function formatRunway(r: Runway): string {
  const lines = [
    '## Publishing runway',
    '',
    `As of ${r.today} (UTC). Runway end: ${r.runwayEnd ?? 'none'} (last live or scheduled article).`,
    '',
    '| Date | Id | Kind | State | VERIFY fields |',
    '| --- | --- | --- | --- | --- |',
    ...r.rows.map((row) => `| ${row.date} | ${row.id} | ${row.kind} | ${row.state} | ${row.verifyFields} |`),
    '',
    `Empty weeks (no article, by Monday): ${r.emptyWeeks.length ? r.emptyWeeks.join(', ') : 'none'}.`,
    '',
    `Drafts due within ${WARN_DAYS} days or overdue: ${r.warnings.length}.`,
    '',
  ];
  return lines.join('\n');
}
