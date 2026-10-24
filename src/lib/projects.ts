import { getCollection, type CollectionEntry } from 'astro:content';
import { isVisibleProject } from './visibility';

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
