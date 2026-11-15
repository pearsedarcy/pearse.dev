import { getCollection } from 'astro:content';
import { MARQUEE, SKILL_MAP } from './site';
import { isCaseStudy } from './visibility';
import { buildSkillGroups, resolveWord, type SkillGroup, type SkillRow } from './skill-map';

/**
 * The skills map from every case study's stack (#163): one group per heading on /stack/, rows in
 * skill-list order. Only case studies (isCaseStudy) count as evidence: a pending client case study
 * or a smaller build has no page to link to (ADR 0006, ADR 0007).
 */
export async function getSkillGroups(): Promise<SkillGroup[]> {
  const projects = await getCollection('projects');
  return buildSkillGroups(
    SKILL_MAP,
    projects.map((p) => p.data),
    (d) => isCaseStudy(d),
  );
}

/**
 * Each marquee word with the /stack/ row of the one skill it resolves to, or no row when that skill
 * has no evidence (the word stays plain text). A word that resolves to no skill or to several fails
 * the build.
 */
export async function getMarqueeWords(): Promise<{ word: string; row?: SkillRow }[]> {
  const rows = (await getSkillGroups()).flatMap((g) => g.rows);
  return MARQUEE.map((word) => {
    const skills = resolveWord(SKILL_MAP, word);
    if (skills.length !== 1) throw new Error(`Marquee word "${word}" resolves to ${skills.length} skills, not one`);
    return { word, row: rows.find((r) => r.name === skills[0].name) };
  });
}
