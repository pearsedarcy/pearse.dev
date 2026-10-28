import { getCollection, type CollectionEntry } from 'astro:content';
import { isVisibleProject } from './visibility';
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

/** Every visible case study, sorted by `order`. */
export async function getVisibleProjects(): Promise<Project[]> {
  const projects = await getCollection('projects', isVisible);
  return projects.sort((a, b) => a.data.order - b.data.order);
}

/**
 * Every visible case study in /work/ order: category groups, then `order` (src/lib/work-order.ts).
 * The /work/ grid, case study numbers and Previous/Next all follow this one list.
 */
export async function getWorkSequence(): Promise<Project[]> {
  const projects = await getCollection('projects', isVisible);
  return projects.sort((a, b) => compareWork(a.data, b.data));
}
