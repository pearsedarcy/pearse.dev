/**
 * Names a case study may give in its `diagram:` frontmatter key. Each one is an
 * Astro component under src/components/diagrams/, registered in its index.ts.
 * Kept here (plain TS, no .astro imports) so the content schema can validate it.
 */
export const DIAGRAM_NAMES = ['MtsHub', 'Ophthix', 'MtsCortex', 'Observability'] as const;
export type DiagramName = (typeof DIAGRAM_NAMES)[number];
