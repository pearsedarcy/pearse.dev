/**
 * The raw text of every excerpt's source file (#152), imported with Vite's `?raw` at build time so
 * an excerpt always matches the file that ships. This is the only module that does `?raw` imports:
 * the content config and the tests use the pure `src/lib/excerpts.ts`. Typed by `ExcerptId`, so an
 * id without a source fails `npm run check`.
 */
import type { ExcerptId } from './excerpts';
import visibility from './visibility.ts?raw';
import gate from '../../scripts/gate.mjs?raw';
import layout from '../components/diagrams/layout.ts?raw';

export const EXCERPT_SOURCES: Record<ExcerptId, string> = {
  'visibility-rules': visibility,
  'gate-reporting': gate,
  'diagram-checks': layout,
};
