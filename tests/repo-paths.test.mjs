// Unit tests for the shared repo-path rule in tests/lib/repo-paths.mjs (#282), used by the
// content-checklists and operations-doc checkers. Pure: reads no files, needs no dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedPaths, inlineTokens, isRepoPath, repoPath, ROOT_FILES, TOP_DIRS } from './lib/repo-paths.mjs';

test('a trailing argument is stripped before the existence check', () => {
  assert.equal(repoPath('automation/setup/credentials.sh renew-token'), 'automation/setup/credentials.sh');
  assert.equal(isRepoPath('automation/setup/credentials.sh renew-token'), true);
  assert.equal(repoPath('.github/workflows/dns.yml'), '.github/workflows/dns.yml');
  assert.equal(repoPath('README.md'), 'README.md');
});

test('env vars, placeholders, commands and dist/ paths are not repo paths', () => {
  for (const t of ['$XDG_STATE_HOME/x', 'gh workflow enable <file>', 'npm run dns', 'dist/index.html', '/work/x/', 'src/<slug>.md', 'tests/*.mjs', 'docs/…']) {
    assert.equal(repoPath(t), null, t);
    assert.equal(isRepoPath(t), false, t);
  }
});

test('citedPaths reads inline code only, outside fences, de-duplicated, arguments stripped', () => {
  const text = [
    'Run `automation/setup/credentials.sh renew-token`, then `automation/setup/credentials.sh` again.',
    '```sh',
    'scripts/not-cited.mjs',
    '`scripts/also-not-cited.mjs`',
    '```',
    'See `npm run dns` and `docs/operations.md`.',
  ].join('\n');
  assert.deepEqual(inlineTokens(text), ['automation/setup/credentials.sh renew-token', 'automation/setup/credentials.sh', 'npm run dns', 'docs/operations.md']);
  assert.deepEqual(citedPaths(text), ['automation/setup/credentials.sh', 'docs/operations.md']);
});

test('the rule exports the known top-level dirs and root files', () => {
  assert.ok(TOP_DIRS.includes('.github/') && TOP_DIRS.includes('automation/'));
  assert.ok(ROOT_FILES.includes('README.md') && ROOT_FILES.includes('package.json'));
});
