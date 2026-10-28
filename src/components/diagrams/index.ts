import type { DiagramName } from '../../lib/diagrams';
import MtsHub from './MtsHub.astro';
import WetlabsApp from './WetlabsApp.astro';
import MtsCortex from './MtsCortex.astro';
import Observability from './Observability.astro';

/** Frontmatter `diagram:` name -> component. Add new diagrams here and in DIAGRAM_NAMES. */
export const DIAGRAMS: Record<DiagramName, typeof MtsHub> = { MtsHub, WetlabsApp, MtsCortex, Observability };
