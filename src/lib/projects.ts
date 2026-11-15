import { getCollection, type CollectionEntry } from 'astro:content';
import { caseStudyRepos, isCaseStudy, isVisibleProject, type CaseStudyRepo } from './visibility';
import { caseNumber, compareWork } from './work-order';

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

/** A case study in the work sequence with its display number: the two-digit `caseNumber` of its position ("07"). */
export type WorkEntry = { project: Project; number: string };

/**
 * Every case study with a page in /work/ order (category groups, then `order`, see src/lib/work-order.ts),
 * each with its display number. This is the one source of case study numbers: the /work/ grid, each
 * case study's eyebrow, Previous/Next and the home "Selected work" cards (looked up by slug) all read
 * it, so a project shows the same number everywhere. Smaller builds are not in it, so they take no number.
 */
export async function getWorkSequence(): Promise<WorkEntry[]> {
  const projects = await getCollection('projects', isFullCaseStudy);
  return projects.sort((a, b) => compareWork(a.data, b.data)).map((project, i) => ({ project, number: caseNumber(i) }));
}

/**
 * The visible smaller builds (`smallerBuild: true`), sorted by `order`: the rows of the
 * /work/ "Smaller builds" list. They have no page of their own (ADR 0007).
 */
export async function getSmallerBuilds(): Promise<Project[]> {
  const projects = await getCollection('projects', (p: Project) => isVisible(p) && p.data.smallerBuild);
  return projects.sort((a, b) => a.data.order - b.data.order);
}

/**
 * The case studies with a page that declare a `repo`, sorted by `order` (caseStudyRepos): the
 * home GitHub section links a repo card to the one whose repo matches it (#275).
 */
export async function getCaseStudyRepos(): Promise<CaseStudyRepo[]> {
  const projects = await getCollection('projects');
  return caseStudyRepos(projects.sort((a, b) => a.data.order - b.data.order).map((p) => p.data));
}
