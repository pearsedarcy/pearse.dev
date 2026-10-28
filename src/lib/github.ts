/**
 * Build-time GitHub integration for the home page (issue #45).
 *
 * Fetches the public profile, the most recently pushed public repositories (REST) and,
 * when a token is present, the last year's contribution calendar (GraphQL), and shapes
 * them into a small view model. A shaped snapshot is committed at src/data/github.json:
 * when the network or the token is unavailable the build uses it and logs a warning, and
 * every successful fetch rewrites it. Only `node:` imports, no `astro:*`, so node:test
 * loads this file with type stripping (tests/github.test.mjs).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const GITHUB_LOGIN = 'pearsedarcy';
export const REPO_COUNT = 6;
/**
 * Public repositories never listed: the profile README repo (not a project) and
 * commissioned work whose name or description names a person.
 */
export const HIDDEN_REPOS: readonly string[] = [GITHUB_LOGIN, 'aprils-site'];
export const SNAPSHOT_PATH = 'src/data/github.json';

const API = 'https://api.github.com';
const WEB = 'https://github.com';
const AVATAR_HOST = 'avatars.githubusercontent.com';

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export interface GithubRepo {
  name: string;
  /** Always https://github.com/<owner>/<name>. */
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  /** Last push, YYYY-MM-DD (UTC). */
  pushed: string;
}

export type Level = 0 | 1 | 2 | 3 | 4;

export interface GithubDay {
  /** YYYY-MM-DD (UTC). */
  date: string;
  count: number;
  level: Level;
}

export interface GithubCalendar {
  total: number;
  /** Sunday-first weeks, oldest first; the first and last week may be partial. */
  weeks: GithubDay[][];
}

export interface GithubView {
  login: string;
  name: string;
  /** Always https://github.com/<login>. */
  url: string;
  /** avatars.githubusercontent.com URL sized for the card, or null. */
  avatarUrl: string | null;
  bio: string | null;
  publicRepos: number;
  followers: number;
  repos: GithubRepo[];
  calendar: GithubCalendar | null;
  /** Day the data was fetched, YYYY-MM-DD (UTC). */
  asOf: string;
}

// ---------------------------------------------------------------------------
// Raw API shapes (only the fields used)
// ---------------------------------------------------------------------------

export interface RawUser {
  login: string;
  name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  public_repos?: number;
  followers?: number;
}

export interface RawRepo {
  name: string;
  private: boolean;
  fork: boolean;
  owner: { login: string };
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  pushed_at?: string | null;
}

export interface RawCalendar {
  totalContributions: number;
  weeks: { contributionDays: { date: string; contributionCount: number; contributionLevel: string }[] }[];
}

// ---------------------------------------------------------------------------
// Shaping (pure)
// ---------------------------------------------------------------------------

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const clean = (s: string | null | undefined) => (s ?? '').trim() || null;

/** Only avatars served by GitHub, resized for an 80px card at 2x. */
export function shapeAvatar(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.hostname !== AVATAR_HOST) return null;
    u.searchParams.set('s', '160');
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Public, non-fork repositories owned by `login` itself (never org repos), minus
 * HIDDEN_REPOS, most recently pushed first, at most `limit`.
 */
export function shapeRepos(raw: RawRepo[], login = GITHUB_LOGIN, limit = REPO_COUNT): GithubRepo[] {
  const me = login.toLowerCase();
  const hidden = new Set(HIDDEN_REPOS.map((n) => n.toLowerCase()));
  return raw
    .filter((r) => !r.private && !r.fork && r.owner?.login?.toLowerCase() === me && !hidden.has(r.name.toLowerCase()))
    .filter((r) => r.pushed_at)
    .sort((a, b) => Date.parse(b.pushed_at!) - Date.parse(a.pushed_at!))
    .slice(0, limit)
    .map((r) => ({
      name: r.name,
      url: `${WEB}/${login}/${r.name}`,
      description: clean(r.description),
      language: clean(r.language),
      stars: r.stargazers_count ?? 0,
      pushed: day(r.pushed_at!),
    }));
}

const LEVELS: Record<string, Level> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

export function shapeCalendar(raw: RawCalendar): GithubCalendar {
  return {
    total: raw.totalContributions,
    weeks: raw.weeks
      .map((w) =>
        w.contributionDays.map((d) => ({
          date: d.date,
          count: d.contributionCount,
          level: LEVELS[d.contributionLevel] ?? (d.contributionCount > 0 ? 1 : 0),
        })),
      )
      .filter((w) => w.length > 0),
  };
}

export function shapeGithub(
  input: { user: RawUser; repos: RawRepo[]; calendar: GithubCalendar | null },
  now = new Date(),
): GithubView {
  const login = input.user.login || GITHUB_LOGIN;
  return {
    login,
    name: clean(input.user.name) ?? login,
    url: `${WEB}/${login}`,
    avatarUrl: shapeAvatar(input.user.avatar_url),
    bio: clean(input.user.bio),
    publicRepos: input.user.public_repos ?? 0,
    followers: input.user.followers ?? 0,
    repos: shapeRepos(input.repos, login),
    calendar: input.calendar,
    asOf: now.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Fetch with snapshot fallback
// ---------------------------------------------------------------------------

export type Source = 'live' | 'partial' | 'snapshot';

export interface LoadResult {
  view: GithubView;
  /** live: everything fetched; partial: profile and repos fetched, calendar from the snapshot; snapshot: nothing fetched. */
  source: Source;
  /** Why something came from the snapshot, when it did. */
  reason?: string;
}

export interface LoadOptions {
  login?: string;
  /** Enables the contribution calendar (GraphQL needs auth). */
  token?: string;
  /** Skip the network entirely. */
  offline?: boolean;
  snapshotPath?: string;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  now?: Date;
  timeoutMs?: number;
}

export function readSnapshot(path: string): GithubView | null {
  try {
    if (!existsSync(path)) return null;
    const v = JSON.parse(readFileSync(path, 'utf8')) as GithubView;
    return v && typeof v.login === 'string' && Array.isArray(v.repos) ? v : null;
  } catch {
    return null;
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadGithub(opts: LoadOptions = {}): Promise<LoadResult> {
  const login = opts.login ?? GITHUB_LOGIN;
  const path = resolve(opts.snapshotPath ?? SNAPSHOT_PATH);
  const doFetch = opts.fetch ?? fetch;
  const log = opts.log ?? ((m: string) => console.log(`[github] ${m}`));
  const warn = opts.warn ?? ((m: string) => console.warn(`[github] ${m}`));
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const snapshot = readSnapshot(path);

  const fromSnapshot = (reason: string): LoadResult => {
    if (!snapshot) throw new Error(`GitHub data unavailable (${reason}) and no snapshot at ${path}`);
    warn(`using snapshot from ${snapshot.asOf}: ${reason}`);
    return { view: snapshot, source: 'snapshot', reason };
  };

  if (opts.offline) return fromSnapshot('fetch disabled');

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pearse.dev-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const getJson = async (url: string, init: RequestInit = {}) => {
    const res = await doFetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url}: HTTP ${res.status}`);
    return res.json();
  };

  let user: RawUser;
  let repos: RawRepo[];
  try {
    [user, repos] = await Promise.all([
      getJson(`${API}/users/${login}`) as Promise<RawUser>,
      getJson(`${API}/users/${login}/repos?type=owner&sort=pushed&per_page=100`) as Promise<RawRepo[]>,
    ]);
    if (!user?.login || !Array.isArray(repos)) throw new Error('unexpected REST response');
  } catch (e) {
    return fromSnapshot(`network: ${errText(e)}`);
  }

  let calendar: GithubCalendar | null = null;
  let reason: string | undefined;
  if (!opts.token) {
    reason = 'no GITHUB_TOKEN for the contribution calendar';
  } else {
    try {
      const body = await getJson(`${API}/graphql`, {
        method: 'POST',
        body: JSON.stringify({
          query:
            'query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}}}',
          variables: { login },
        }),
      });
      const raw = body?.data?.user?.contributionsCollection?.contributionCalendar as RawCalendar | undefined;
      if (body?.errors?.length || !raw) throw new Error(body?.errors?.[0]?.message ?? 'no calendar in GraphQL response');
      calendar = shapeCalendar(raw);
    } catch (e) {
      reason = `calendar: ${errText(e)}`;
    }
  }

  let source: Source = 'live';
  if (!calendar) {
    source = 'partial';
    calendar = snapshot?.calendar ?? null;
    warn(`contribution calendar from snapshot${snapshot ? ` of ${snapshot.asOf}` : ' (none)'}: ${reason}`);
  }

  const view = shapeGithub({ user, repos, calendar }, opts.now);
  log(`${source === 'live' ? 'live' : 'live profile and repos'}: ${view.repos.length} repos${source === 'live' ? `, ${view.calendar?.total ?? 0} contributions` : ''}`);

  try {
    const json = `${JSON.stringify(view, null, 2)}\n`;
    if (!existsSync(path) || readFileSync(path, 'utf8') !== json) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, json);
      log(`snapshot written to ${opts.snapshotPath ?? SNAPSHOT_PATH}`);
    }
  } catch (e) {
    warn(`could not write snapshot: ${errText(e)}`);
  }

  return { view, source, reason };
}

let cached: Promise<LoadResult> | undefined;

/**
 * The build's GitHub data, fetched once per build. GITHUB_TOKEN enables the calendar;
 * GITHUB_FETCH=0 forces the snapshot.
 */
export function getGithub(): Promise<LoadResult> {
  cached ??= loadGithub({ token: process.env.GITHUB_TOKEN || undefined, offline: process.env.GITHUB_FETCH === '0' });
  return cached;
}
