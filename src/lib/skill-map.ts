/**
 * The skills map (#163) as pure functions of the skill config (SKILL_MAP in src/lib/site.ts) and
 * plain case-study data. It imports nothing, so tests/*.test.mjs load it straight through Node's
 * type stripping, and it uses no enums or namespaces for the same reason. The caller passes the
 * map, the projects and the visibility rule in as arguments. One output drives /stack/, the
 * compact matrices on the home About section and the CV, and the marquee links.
 */

export interface SkillEntry {
  name: string;
  group: string;
  /** Exact stack strings that count as evidence for this skill. */
  aliases?: readonly string[];
  /** Other words the site uses for the skill (the marquee). Never evidence. */
  labels?: readonly string[];
  /**
   * Names of skills this one always entails (Django is a Python framework). A stack string that
   * evidences this skill also evidences each of them. One level: an implied skill's own `implies`
   * are not followed.
   */
  implies?: readonly string[];
}

export interface SkillConfig {
  groups: readonly string[];
  skills: readonly SkillEntry[];
  ignore: readonly string[];
}

export interface SectionData {
  id: string;
  title: string;
  stack?: readonly string[];
}

export interface ProjectData {
  slug: string;
  title: string;
  period: string;
  order: number;
  stack: readonly string[];
  sections?: readonly SectionData[];
}

export interface EvidenceLink {
  href: string;
  /** Always the case-study title, or "<title>, <section title>". */
  text: string;
}

export interface Evidence {
  slug: string;
  title: string;
  /** The case study's own `period` text, verbatim. */
  period: string;
  /** One link to the case study when its main stack names the skill, else one per naming section. */
  links: EvidenceLink[];
}

export interface SkillRow {
  name: string;
  group: string;
  /** `skill-` plus the slug of the name (skillAnchor). */
  anchor: string;
  /** Position in the config's skill list: what a capped block keeps first (limitRows). */
  index: number;
  /** Case studies that name the skill, each counted once. Never zero. */
  count: number;
  /** The latest case study: its own period text and the href of its first evidence link. */
  latest: { slug: string; title: string; period: string; href: string };
  /**
   * The earliest start year across the evidence (periodBounds): the first case study that names the
   * skill, not first use, so it understates use from before the case studies (#274).
   */
  earliest: number;
  /** Latest first (compareLatest). */
  evidence: Evidence[];
}

export interface SkillGroup {
  name: string;
  rows: SkillRow[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEAR = /^(?:([A-Z][a-z]{2}) )?((?:19|20)\d{2})$/;

/** One side of a period: a year, and a month 1 to 12 when the text names one. */
export interface PeriodPoint {
  year: number;
  month?: number;
}

/** A parsed `period`: explicit start and end points, and comparable keys derived from them. */
export interface PeriodBounds {
  /** Comparable start key (pointKey). */
  start: number;
  /** Comparable end key (pointKey); Infinity for "Present". */
  end: number;
  startYear: number;
  startMonth?: number;
  /** Null for "Present". */
  endYear: number | null;
  endMonth?: number;
}

/** "Mon YYYY" or "YYYY"; undefined for anything else. */
function point(text: string): PeriodPoint | undefined {
  const m = YEAR.exec(text);
  if (!m) return undefined;
  const year = Number(m[2]);
  if (m[1] === undefined) return { year };
  const month = MONTHS.indexOf(m[1]);
  return month < 0 ? undefined : { year, month: month + 1 };
}

/**
 * A comparable key: 13 slots per year, a year alone in slot 0 and each month in its own slot 1 to 12,
 * so "Dec 2026" < "2027" < "Jan 2027" (#274). Thirteen, not twelve: with twelve, "Dec 2026" and
 * "2027" shared a key.
 */
const pointKey = (p: PeriodPoint): number => p.year * 13 + (p.month ?? 0);

/**
 * The start and end of a `period` string. The end is the text after the en dash, or the whole
 * string when there is none. A month-only start takes the end's year ("Jul – Oct 2026",
 * "Oct – Dec 2026" both start in 2026). "Present" is only ever an end and ranks above every date.
 * A year-only part ranks as month 0 of that year. Anything else throws, naming the period and the
 * slug.
 */
export function periodBounds(period: string, slug: string): PeriodBounds {
  const fail = () => new Error(`Unparseable period "${period}" in case study "${slug}"`);
  const parts = period.split('–').map((s) => s.trim());
  if (parts.length > 2 || parts.some((s) => !s)) throw fail();
  const endText = parts[parts.length - 1];
  const present = endText === 'Present' && parts.length === 2;
  const end = present ? undefined : point(endText);
  if (!present && end === undefined) throw fail();
  let start = parts.length === 1 ? end : point(parts[0]);
  if (start === undefined && end !== undefined && MONTHS.includes(parts[0])) {
    start = { year: end.year, month: MONTHS.indexOf(parts[0]) + 1 };
  }
  if (start === undefined) throw fail();
  return {
    start: pointKey(start),
    end: end === undefined ? Infinity : pointKey(end),
    startYear: start.year,
    ...(start.month === undefined ? {} : { startMonth: start.month }),
    endYear: end === undefined ? null : end.year,
    ...(end?.month === undefined ? {} : { endMonth: end.month }),
  };
}

const cmp = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * Latest first: the later end, then the later start, then the lower `order`, then the slug.
 * Throws on an unparseable period (periodBounds).
 */
export function compareLatest(
  a: { slug: string; period: string; order: number },
  b: { slug: string; period: string; order: number },
): number {
  const pa = periodBounds(a.period, a.slug);
  const pb = periodBounds(b.period, b.slug);
  return cmp(pb.end, pa.end) || cmp(pb.start, pa.start) || a.order - b.order || a.slug.localeCompare(b.slug);
}

/** `skill-` plus the name lowercased, each run of non-alphanumerics one hyphen: "Three.js" -> "skill-three-js". */
export function skillAnchor(name: string): string {
  return `skill-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/**
 * The skills a stack string is evidence for: by exact name or exact alias, plus every skill those
 * imply (`implies`, one level). In config order, each once. Empty when none.
 */
export function skillsForStack(config: SkillConfig, stack: string): SkillEntry[] {
  const direct = config.skills.filter((s) => s.name === stack || (s.aliases ?? []).includes(stack));
  const implied = new Set(direct.flatMap((s) => s.implies ?? []));
  return config.skills.filter((s) => direct.includes(s) || implied.has(s.name));
}

/** The skills a display word (a marquee word) resolves to: by name, alias or label. */
export function resolveWord(config: SkillConfig, word: string): SkillEntry[] {
  return config.skills.filter((s) => s.name === word || (s.aliases ?? []).includes(word) || (s.labels ?? []).includes(word));
}

/** Every stack string of a case study: its main stack, then each section's. */
export function stackStrings(project: ProjectData): string[] {
  return [...project.stack, ...(project.sections ?? []).flatMap((s) => s.stack ?? [])];
}

function checkConfig(config: SkillConfig): void {
  const names = new Set<string>();
  const anchors = new Set<string>();
  for (const s of config.skills) {
    if (!config.groups.includes(s.group)) throw new Error(`Skill "${s.name}" has unknown group "${s.group}"`);
    if (names.has(s.name)) throw new Error(`Skill "${s.name}" is listed twice`);
    const anchor = skillAnchor(s.name);
    if (anchors.has(anchor)) throw new Error(`Skill "${s.name}" repeats the anchor "${anchor}"`);
    names.add(s.name);
    anchors.add(anchor);
  }
  for (const s of config.skills) {
    for (const i of s.implies ?? []) {
      if (i === s.name) throw new Error(`Skill "${s.name}" implies itself`);
      if (!names.has(i)) throw new Error(`Skill "${s.name}" implies unknown skill "${i}"`);
    }
  }
}

/**
 * The skills map, grouped: groups in config order, rows in skill-list order. Only projects that
 * pass `isEvidence` count. A case study counts once per skill, however many of its stack strings
 * name it. A skill with no evidence gets no row and a group with no row is left out. Every
 * evidence project's period must parse (periodBounds), or this throws. `earliest` comes from the
 * same evidence, so a hidden case study never lowers it.
 */
export function buildSkillGroups<P extends ProjectData>(
  config: SkillConfig,
  projects: readonly P[],
  isEvidence: (project: P) => boolean,
): SkillGroup[] {
  checkConfig(config);
  const visible = projects.filter(isEvidence);
  for (const p of visible) periodBounds(p.period, p.slug);

  const rows: SkillRow[] = [];
  config.skills.forEach((skill, index) => {
    const names = (stack: readonly string[] | undefined) => (stack ?? []).some((s) => skillsForStack(config, s).includes(skill));
    const evidence: (Evidence & { order: number })[] = [];
    for (const p of visible) {
      const base = `/work/${p.slug}/`;
      let links: EvidenceLink[];
      if (names(p.stack)) links = [{ href: base, text: p.title }];
      else links = (p.sections ?? []).filter((s) => names(s.stack)).map((s) => ({ href: `${base}#${s.id}`, text: `${p.title}, ${s.title}` }));
      if (links.length) evidence.push({ slug: p.slug, title: p.title, period: p.period, order: p.order, links });
    }
    if (!evidence.length) return;
    evidence.sort(compareLatest);
    const top = evidence[0];
    rows.push({
      name: skill.name,
      group: skill.group,
      anchor: skillAnchor(skill.name),
      index,
      count: evidence.length,
      latest: { slug: top.slug, title: top.title, period: top.period, href: top.links[0].href },
      earliest: Math.min(...evidence.map((e) => periodBounds(e.period, e.slug).startYear)),
      evidence: evidence.map(({ order: _order, ...e }) => e),
    });
  });

  return config.groups
    .map((name) => ({ name, rows: rows.filter((r) => r.group === name) }))
    .filter((g) => g.rows.length > 0);
}

/** How many skills the map lists: one per row, across every group. The /stack/ eyebrow and its Open Graph card both count with this (#278). */
export function countSkills(groups: readonly SkillGroup[]): number {
  return groups.reduce((n, g) => n + g.rows.length, 0);
}

/**
 * At most `limit` rows for a compact block (the CV): the first rows in skill-list order (the
 * positioning order), shown in group and list order. Groups left empty drop out.
 */
export function limitRows(groups: readonly SkillGroup[], limit: number): SkillGroup[] {
  const keep = new Set(
    groups
      .flatMap((g) => g.rows)
      .sort((a, b) => a.index - b.index)
      .slice(0, limit)
      .map((r) => r.name),
  );
  return groups.map((g) => ({ name: g.name, rows: g.rows.filter((r) => keep.has(r.name)) })).filter((g) => g.rows.length > 0);
}
