#!/usr/bin/env node
/**
 * Point git at the tracked hooks in `.githooks` (`core.hooksPath`), run by `npm run prepare`
 * (#127). Dependency-free and it ALWAYS exits 0: a failed install must never break `npm ci`.
 * It skips silently under CI and outside a git work tree, and when `core.hooksPath` is already
 * set to something else it warns and leaves that value alone.
 */
import { execFileSync } from 'node:child_process';

const HOOKS_DIR = '.githooks';

function git(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
}

try {
  if (!process.env.CI) {
    if (git(['rev-parse', '--is-inside-work-tree']) === 'true') {
      let current = '';
      try {
        current = git(['config', '--get', 'core.hooksPath']);
      } catch {
        current = ''; // unset: git config exits 1
      }
      if (current === HOOKS_DIR) {
        // already installed
      } else if (current) {
        console.warn(
          `install-hooks: core.hooksPath is already set to something else; left unchanged. ` +
            `The confidentiality pre-commit hook is NOT installed (set it to ${HOOKS_DIR} to enable).`,
        );
      } else {
        git(['config', 'core.hooksPath', HOOKS_DIR]);
        console.log(`install-hooks: core.hooksPath set to ${HOOKS_DIR}`);
      }
    }
  }
} catch {
  // not a git work tree, git missing, or config not writable: nothing to do
}
process.exit(0);
