/**
 * The home Timeline, derived from the CV (src/content/cv/cv.md) so the two cannot disagree (#168).
 * Every CV entry is a row; `milestones` adds the rows that are not CV entries. Pure, with no
 * `astro:` import and only erasable TypeScript, so node's test runner imports it directly.
 * The input shape is defined here on purpose instead of being taken from `astro:content`.
 */

export interface TimelineEntryInput {
  title: string;
  organisation: string;
  period: string;
  timeline: { headline: string; now?: boolean };
  products?: { name: string; timeline?: { headline: string } }[];
}

export interface TimelineMilestoneInput {
  period: string;
  context: string;
  href?: string;
  headline: string;
  sortYear?: number;
}

export interface TimelineInput {
  experience: TimelineEntryInput[];
  education: TimelineEntryInput[];
  before?: TimelineEntryInput[];
  milestones?: TimelineMilestoneInput[];
}

export interface TimelineRow {
  period: string;
  context: string;
  href?: string;
  headline: string;
  /** The CV entry's organisation; absent for a milestone. */
  organisation?: string;
  now: boolean;
  products: { name: string; headline: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Every period separates its start and end with an en dash between single spaces. */
export const PERIOD_SEPARATOR = ' – ';

/**
 * Ordering key for a period: its start (the text before " – ") as months since year 0.
 * Accepts "Mon YYYY", "YYYY" and "From YYYY". A start with no four-digit year uses `sortYear`;
 * without one it throws, so a typo such as "Jul – Present" fails the build.
 */
export function sortKey(period: string, sortYear?: number): number {
  const start = period.split(PERIOD_SEPARATOR)[0].trim();
  const m = start.match(/^(?:From )?(?:([A-Z][a-z]{2}) )?(\d{4})$/);
  if (m) {
    if (sortYear !== undefined) throw new Error(`timeline: "${period}" has a year, so it takes no sortYear`);
    const month = m[1] === undefined ? 0 : MONTHS.indexOf(m[1]);
    if (month < 0) throw new Error(`timeline: unknown month in "${period}"`);
    return Number(m[2]) * 12 + month;
  }
  if (/\d{4}/.test(start)) throw new Error(`timeline: cannot parse the start of "${period}"`);
  if (sortYear === undefined) throw new Error(`timeline: "${period}" has no year and no sortYear`);
  return sortYear * 12;
}

/**
 * The Timeline's rows, oldest first. Rows with the same start keep their source order
 * (before, education, experience, then milestones). Exactly one CV entry carries
 * `timeline.now`, and its period must end "– Present"; anything else throws.
 */
export function timelineRows(cv: TimelineInput): TimelineRow[] {
  const entries = [...(cv.before ?? []), ...cv.education, ...cv.experience];
  const marked = entries.filter((e) => e.timeline.now === true);
  if (marked.length !== 1) {
    throw new Error(`timeline: exactly one CV entry must set timeline.now, found ${marked.length}`);
  }
  if (!marked[0].period.endsWith(`${PERIOD_SEPARATOR}Present`)) {
    throw new Error(`timeline: the now entry's period "${marked[0].period}" does not end "– Present"`);
  }

  const rows: { key: number; row: TimelineRow }[] = entries.map((e) => ({
    key: sortKey(e.period),
    row: {
      period: e.period,
      context: `${e.title}, ${e.organisation}`,
      headline: e.timeline.headline,
      organisation: e.organisation,
      now: e.timeline.now === true,
      products: (e.products ?? []).flatMap((p) => (p.timeline ? [{ name: p.name, headline: p.timeline.headline }] : [])),
    },
  }));
  for (const m of cv.milestones ?? []) {
    rows.push({
      key: sortKey(m.period, m.sortYear),
      row: {
        period: m.period,
        context: m.context,
        ...(m.href === undefined ? {} : { href: m.href }),
        headline: m.headline,
        now: false,
        products: [],
      },
    });
  }
  // Array.prototype.sort is stable, so equal keys keep their source order.
  return rows.sort((a, b) => a.key - b.key).map((r) => r.row);
}
