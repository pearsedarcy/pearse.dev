/**
 * The /work/ sequence as pure functions of frontmatter data, with no `astro:content`
 * import, so build scripts (scripts/og-pages.mjs) number case studies exactly as the
 * pages do. One sequence drives the /work/ grid, each case study's eyebrow number, its
 * Previous/Next links and its Open Graph card: category groups in CATEGORY_ORDER, then
 * `order` within a group. A case study's number is its position in that sequence, never
 * the raw `order` value, so numbers stay unique and consecutive when entries are hidden.
 * The home "Selected work" cards follow it too: they keep their own selection, shown in sequence order, and
 * each card shows its slug's number from the sequence, never its position in the home grid.
 */

/** The /work/ groups, top to bottom. */
export const CATEGORY_ORDER = ['mts', 'client', 'tool', 'learning'] as const;

type Sortable = { category: string; order: number; slug: string };

const rank = (category: string) => {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return i < 0 ? CATEGORY_ORDER.length : i;
};

/** Category group first, then `order`, then slug so a tie can never reorder between builds. */
export function compareWork(a: Sortable, b: Sortable): number {
  return rank(a.category) - rank(b.category) || a.order - b.order || a.slug.localeCompare(b.slug);
}

/** A count or one-based position as the two-digit label the pages show: 7 -> "07". */
export function twoDigit(n: number): string {
  return String(n).padStart(2, '0');
}

/** A zero-based position in the sequence as the two-digit number the pages show: 0 -> "01". */
export function caseNumber(index: number): string {
  return twoDigit(index + 1);
}

/** The earliest four-digit year in any `period` string ("Mar – Apr 2024", "2022 – 2026"), or undefined if none has one. */
export function earliestYear(periods: readonly string[]): number | undefined {
  const years = periods.flatMap((p) => [...p.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])));
  return years.length ? Math.min(...years) : undefined;
}
