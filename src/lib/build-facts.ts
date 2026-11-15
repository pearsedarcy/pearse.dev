// Build facts (#287, GLOSSARY "Outcome"): figures about this site's own repository, computed at
// build from the checkout so they cannot drift from it. The impure collector
// (src/lib/build-facts-git.ts) reads git and the file system; everything else lives here and is
// pure: the constants, trailer parsing, the "most" rule, and the row and sentence builders.
// The schema (src/content.config.ts), the case page and the tests (Node type stripping) all
// load it, so imports carry explicit `.ts` extensions.
//
// Confidentiality: rendered text is built only from the constants below and integers. No
// trailer text, commit subject, author, email or branch name ever leaves these functions.
import { SITE } from './site.ts';
import type { OutcomeIssue, OutcomeItem } from './outcomes.ts';

/** The glob `npm test` runs. package.json's `test` script contains it verbatim (tests assert it). */
export const TEST_GLOB = 'tests/**/*.test.mjs';

/** An ADR file in docs/adr/. */
export const ADR_FILE = /^\d{4}-.+\.md$/;

/** Model families named after "Claude" in a co-author trailer. This order breaks count ties. */
export const MODEL_FAMILIES = ['Fable', 'Opus', 'Sonnet', 'Haiku'] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/** Row labels, in row order. Each is ≤ 40 characters and has no business-count word. */
export const FACT_LABELS = {
  testFiles: 'test files',
  adrs: 'ADRs',
  mergedPRs: 'merged pull requests',
  agentCommits: 'commits with a Claude co-author',
} as const;

export interface GitFacts {
  /** Non-merge commits reachable from HEAD. */
  commits: number;
  /** Of those, commits with at least one Claude co-author trailer. */
  agentCommits: number;
  /** Distinct N in first-parent subjects "Merge pull request #N …". */
  mergedPRs: number;
  /** Count desc, then MODEL_FAMILIES order; zero counts dropped. */
  families: { family: ModelFamily; trailers: number }[];
}

export interface BuildFacts {
  /** Files matching TEST_GLOB. */
  testFiles: number;
  /** docs/adr/ entries matching ADR_FILE. */
  adrs: number;
  /** Absent when git fails or the clone is shallow. */
  git?: GitFacts;
}

const TRAILER_LINE = /^([A-Za-z0-9-]+)\s*:\s*(.*)$/;
const CO_AUTHOR = 'co-authored-by';

/**
 * One trailer value classified. `null`: not a Claude trailer (a human, a bot), ignored entirely.
 * Otherwise a Claude trailer, with a family only when the word after "Claude" is one of
 * MODEL_FAMILIES with exact case ("Claude Code" and a bare "Claude <…>" have none).
 */
export function claudeTrailer(value: string): { family?: ModelFamily } | null {
  const v = value.trim();
  if (!/^Claude\b/.test(v)) return null;
  const next = v.match(/^Claude\s+(\S+)/)?.[1];
  const family = MODEL_FAMILIES.find((f) => f === next);
  return family ? { family } : {};
}

/** One commit's trailer lines ("Key: value") reduced to: has a Claude co-author, and which families. */
export function commitAgents(trailerLines: readonly string[]): { agent: boolean; families: Set<ModelFamily> } {
  let agent = false;
  const families = new Set<ModelFamily>();
  for (const line of trailerLines) {
    const m = line.match(TRAILER_LINE);
    if (!m || m[1]!.toLowerCase() !== CO_AUTHOR) continue;
    const claude = claudeTrailer(m[2]!);
    if (!claude) continue;
    agent = true;
    if (claude.family) families.add(claude.family);
  }
  return { agent, families };
}

/**
 * Splits `git log --format=%x1e%(trailers:only,unfold)` output into one list of trailer lines
 * per commit. Every record starts with the 0x1e separator, so a commit with no trailers is an
 * empty list and still counts.
 */
export function splitTrailerLog(raw: string): string[][] {
  return raw
    .split('\x1e')
    .slice(1)
    .map((rec) => rec.split('\n').map((l) => l.trim()).filter((l) => l.length > 0));
}

/** Distinct N among first-parent subjects that start "Merge pull request #N". Other merges never count. */
export function countMergedPRs(subjects: readonly string[]): number {
  const prs = new Set<string>();
  for (const s of subjects) {
    const m = s.match(/^Merge pull request #(\d+)\b/);
    if (m) prs.add(m[1]!);
  }
  return prs.size;
}

/** The git facts from each non-merge commit's trailer lines and the first-parent subjects. */
export function gitFacts(commits: readonly (readonly string[])[], subjects: readonly string[]): GitFacts {
  let agentCommits = 0;
  const counts = new Map<ModelFamily, number>();
  for (const lines of commits) {
    const { agent, families } = commitAgents(lines);
    if (agent) agentCommits += 1;
    for (const f of families) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const families = MODEL_FAMILIES.map((family) => ({ family, trailers: counts.get(family) ?? 0 }))
    .filter((f) => f.trailers > 0)
    .sort((a, b) => b.trailers - a.trailers || MODEL_FAMILIES.indexOf(a.family) - MODEL_FAMILIES.indexOf(b.family));
  return { commits: commits.length, agentCommits, mergedPRs: countMergedPRs(subjects), families };
}

/** The "most" rule: agents wrote most of it only when more than half the commits have a Claude co-author. */
export const agentsWroteMost = ({ commits, agentCommits }: Pick<GitFacts, 'commits' | 'agentCommits'>): boolean =>
  agentCommits * 2 > commits;

/** The computed outcomes row, in fixed order: items 1–2 always, items 3–4 only with git. */
export function factsRow(facts: BuildFacts): OutcomeItem[] {
  const row: OutcomeItem[] = [
    { value: String(facts.testFiles), label: FACT_LABELS.testFiles },
    { value: String(facts.adrs), label: FACT_LABELS.adrs },
  ];
  if (facts.git) {
    row.push(
      { value: String(facts.git.mergedPRs), label: FACT_LABELS.mergedPRs },
      { value: String(facts.git.agentCommits), label: FACT_LABELS.agentCommits },
    );
  }
  return row;
}

/** S1 (always) and S2 (git only): the computed paragraph that closes the colophon. */
export function factsSentences(facts: BuildFacts): string[] {
  const s1 = `At this build the repository holds ${facts.testFiles} test files and ${facts.adrs} ADRs in docs/adr/.`;
  const g = facts.git;
  if (!g) return [s1];
  const families = g.families.length > 0 ? ` (${g.families.map((f) => `${f.trailers} ${f.family}`).join(', ')})` : '';
  const most = agentsWroteMost(g) ? ', so agents wrote most of it' : '';
  const s2 = `${g.mergedPRs} pull requests have merged, and ${g.agentCommits} of its ${g.commits} commits carry a Claude co-author trailer${families}${most}.`;
  return [s1, s2];
}

export const factsParagraph = (facts: BuildFacts): string => factsSentences(facts).join(' ');

/**
 * The schema's `buildFacts` rules: only an entry whose `repo` is this site's own repository may
 * opt in, and it may not also set a hand-written `outcomes` row, because the row is computed.
 */
export function buildFactsIssues(d: { buildFacts?: boolean; repo?: string; outcomes?: unknown }): OutcomeIssue[] {
  if (d.buildFacts !== true) return [];
  const issues: OutcomeIssue[] = [];
  if (d.repo !== SITE.repo) {
    issues.push({ path: 'buildFacts', message: "buildFacts: only this site's own repository can compute build facts; set repo to it or drop buildFacts" });
  }
  if (d.outcomes !== undefined) {
    issues.push({ path: 'outcomes', message: 'outcomes: buildFacts computes the row; remove the hand-written outcomes' });
  }
  return issues;
}
