import { getCollection, type CollectionEntry } from 'astro:content';
import { isCaseStudy, isVisibleProject } from './visibility';
import { compareWork } from './work-order';

export type Project = CollectionEntry<'projects'>;

/**
 * Visible = not a client case study awaiting permission. Only `category: client`
 * is gated by `clientPermission`; every other case study is always visible.
 * The sitemap follows the built pages, so hidden projects drop out of it automatically.
 */
export function isVisible(project: Project): boolean {
  return isVisibleProject(project.data);
}

/** A case study with its own page: visible and not a smaller build (isCaseStudy). */
export function isFullCaseStudy(project: Project): boolean {
  return isCaseStudy(project.data);
}

/** Every case study with a page (isCaseStudy), sorted by `order`. Smaller builds are not in it. */
export async function getVisibleProjects(): Promise<Project[]> {
  const projects = await getCollection('projects', isFullCaseStudy);
  return projects.sort((a, b) => a.data.order - b.data.order);
}

/**
 * Every case study with a page in /work/ order: category groups, then `order` (src/lib/work-order.ts).
 * The /work/ grid, case study numbers and Previous/Next all follow this one list. Smaller builds
 * are not in it, so they take no number.
 */
export async function getWorkSequence(): Promise<Project[]> {
  const projects = await getCollection('projects', isFullCaseStudy);
  return projects.sort((a, b) => compareWork(a.data, b.data));
}

/**
 * The visible smaller builds (`smallerBuild: true`), sorted by `order`: the rows of the
 * /work/ "Smaller builds" list. They have no page of their own (ADR 0007).
 */
export async function getSmallerBuilds(): Promise<Project[]> {
  const projects = await getCollection('projects', (p: Project) => isVisible(p) && p.data.smallerBuild);
  return projects.sort((a, b) => a.data.order - b.data.order);
}
