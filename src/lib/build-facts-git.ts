// The impure half of the build facts (#287): reads the checkout and its git history and hands
// the raw lines straight to the pure parsers in ./build-facts.ts. Git runs through execFile with
// fixed arguments and no shell, with stderr discarded. Nothing read here is logged: commit
// messages can name private work and CI logs are public. The one warning is a fixed line.
// Called from the case page at build (never from a content loader, whose data store is cached
// across builds) and from the tests, which recompute the same figures from the same HEAD.
import { execFileSync } from 'node:child_process';
import { globSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ADR_FILE, TEST_GLOB, gitFacts, splitTrailerLog, type BuildFacts, type GitFacts } from './build-facts.ts';

const GIT_MAX_BUFFER = 64 * 1024 * 1024;

// Git reads the repository at `root`, never one a GIT_DIR or GIT_WORK_TREE inherited from a hook names.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: root, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_MAX_BUFFER });
}

/** The git facts, or undefined when git fails or the clone is shallow (its counts would be wrong). */
function collectGit(root: string): GitFacts | undefined {
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'false') return undefined;
    const trailers = splitTrailerLog(git(root, ['log', '--no-merges', '--format=%x1e%(trailers:only,unfold)', 'HEAD']));
    const subjects = git(root, ['log', '--first-parent', '--format=%s', 'HEAD']).split('\n');
    return gitFacts(trailers, subjects);
  } catch {
    return undefined;
  }
}

const memo = new Map<string, BuildFacts>();

/** The build facts for the checkout at `root` (default: the working directory), memoised per build. */
export function collectBuildFacts(root: string = process.cwd()): BuildFacts {
  const key = resolve(root);
  const cached = memo.get(key);
  if (cached) return cached;
  const testFiles = globSync(TEST_GLOB, { cwd: key }).length;
  const adrs = readdirSync(join(key, 'docs/adr')).filter((f) => ADR_FILE.test(f)).length;
  const g = collectGit(key);
  if (!g) console.warn('build-facts: no full git history (shallow clone or git unavailable); git figures omitted');
  const facts: BuildFacts = g ? { testFiles, adrs, git: g } : { testFiles, adrs };
  memo.set(key, facts);
  return facts;
}
