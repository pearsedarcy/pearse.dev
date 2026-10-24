import { getCollection, type CollectionEntry } from 'astro:content';

export type Project = CollectionEntry<'projects'>;

/**
 * Visible = not a client case study awaiting permission. Only `category: client`
 * is gated by `clientPermission`; every other case study is always visible.
 */
export function isVisible(project: Project): boolean {
  return project.data.category !== 'client' || project.data.clientPermission !== 'pending';
}

/** Every visible case study, sorted by `order`. */
export async function getVisibleProjects(): Promise<Project[]> {
  const projects = await getCollection('projects', isVisible);
  return projects.sort((a, b) => a.data.order - b.data.order);
}
