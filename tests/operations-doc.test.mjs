// Keeps docs/operations.md, the page listing everything that expires and stops publishing, from
// drifting away from the repo (#282). Reads source files only, never dist/, so
// `node --test tests/operations-doc.test.mjs` passes with no build.
//
// The six rules live in the pure checkOperationsDoc() in tests/lib/operations-doc.mjs: the table
// header, the security.txt Expires value, every scheduled workflow named, every cited path present,
// both READMEs linking the page, and no old names. Fixtures below prove each rule can fail. The
// Last renewed column is not checked by the rules; the real page's values are pinned here instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { OLD_NAMES } from './lib/old-names.mjs';
import { checkOperationsDoc, HEADER, operationsTable, PAGE_PATH } from './lib/operations-doc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const exists = (p) => existsSync(resolve(ROOT, p));

const workflows = () =>
  Object.fromEntries(
    readdirSync(resolve(ROOT, '.github/workflows'))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [`.github/workflows/${f}`, parse(read(`.github/workflows/${f}`))]),
  );

const real = () => ({
  page: read(PAGE_PATH),
  securityTxt: read('public/.well-known/security.txt'),
  workflows: workflows(),
  readmes: { 'README.md': read('README.md'), 'automation/README.md': read('automation/README.md') },
  exists,
});

test('the real page agrees with the READMEs, workflows and security.txt', () => {
  assert.deepEqual(checkOperationsDoc(real()), []);
});

test('the real repo has at least six scheduled workflows, so the schedule rule checks something', () => {
  const scheduled = Object.entries(workflows()).filter(([, w]) => (w.on ?? w[true])?.schedule);
  assert.ok(scheduled.length >= 6, `only ${scheduled.length} scheduled workflows parsed`);
});

test('the table has the five rows in order, with the given Last renewed values', () => {
  const table = operationsTable(read(PAGE_PATH));
  assert.ok(table, 'no operations table');
  assert.deepEqual(
    table.rows.map((r) => [r[0], r[HEADER.length - 1]]),
    [
      ['LinkedIn member token', 'not yet issued (#13)'],
      ['`security.txt` Expires', '2026-11-02 (#140)'],
      ['Scheduled workflows', 'n/a: last push to master (see git log)'],
      ['Domain registration', 'not tracked in the repo'],
      ['Publishing runway', 'n/a'],
    ],
  );
  for (const r of table.rows) assert.equal(r.length, HEADER.length, `row ${r[0]} has ${r.length} cells`);
});

test('the page ends by asking for the Last renewed cell to be updated', () => {
  assert.match(read(PAGE_PATH).trimEnd().split('\n').at(-1), /^After renewing anything, update its Last renewed cell in the same PR\.$/);
});

// --- Fixtures: each rule fails on its own, with its own message. ---

const SEC = 'Contact: mailto:a@example.org\nExpires: 2030-01-01T00:00:00Z\n';
const TABLE = [
  `| ${HEADER.join(' | ')} |`,
  '|---|---|---|---|---|',
  '| `security.txt` Expires | 2030-01-01T00:00:00Z | x | x | x |',
].join('\n');
const PAGE = `${TABLE}\n\nNamed: \`.github/workflows/deploy.yml\`. Cites \`scripts/real.mjs run\`.\n`;
const fixture = (over = {}) => ({
  page: PAGE,
  securityTxt: SEC,
  workflows: { '.github/workflows/deploy.yml': { on: { schedule: [{ cron: '1 2 * * *' }] } }, '.github/workflows/check.yml': { on: { workflow_call: null } } },
  readmes: { 'README.md': '- [ops](docs/operations.md)\n', 'automation/README.md': 'See [ops](../docs/operations.md#top).\n' },
  exists: (p) => ['scripts/real.mjs', '.github/workflows/deploy.yml'].includes(p),
  ...over,
});

test('the fixture itself passes, so each failure below is the rule under test', () => {
  assert.deepEqual(checkOperationsDoc(fixture()), []);
});

test('rule 1: a misspelled header fails', () => {
  const page = PAGE.replace('Lifetime / current expiry', 'Lifetime/current expiry');
  assert.deepEqual(checkOperationsDoc(fixture({ page })), [`${PAGE_PATH} has no table whose header is exactly: ${HEADER.join(' | ')}`]);
});

test('rule 1: other tables on the page are allowed', () => {
  const page = `| a | b |\n|---|---|\n| 1 | 2 |\n\n${PAGE}`;
  assert.deepEqual(checkOperationsDoc(fixture({ page })), []);
});

test('rule 2: a stale Expires value fails', () => {
  const securityTxt = SEC.replace('2030-01-01', '2031-01-01');
  assert.deepEqual(checkOperationsDoc(fixture({ securityTxt })), [`${PAGE_PATH} security.txt row does not contain the current Expires value 2031-01-01T00:00:00Z`]);
});

test('rule 3: a scheduled workflow dropped from the page fails, .yml, .yaml and a `true:` key alike', () => {
  const workflows = {
    ...fixture().workflows,
    '.github/workflows/weekly.yaml': { on: { schedule: [{ cron: '0 0 * * 0' }] } },
    '.github/workflows/old.yml': parse("true:\n  schedule:\n    - cron: '0 0 * * 1'\n"),
    '.github/workflows/push.yml': parse('on: push\n'),
    '.github/workflows/comment.yml': parse("# cron: '0 0 * * 1' in a comment is not a schedule\non:\n  push:\n"),
  };
  assert.deepEqual(checkOperationsDoc(fixture({ workflows })), [
    `${PAGE_PATH} does not name the scheduled workflow weekly.yaml`,
    `${PAGE_PATH} does not name the scheduled workflow old.yml`,
  ]);
});

test('rule 4: a broken cited path fails, checked without its trailing argument', () => {
  const page = `${PAGE}Also \`automation/setup/gone.sh renew-token\` and \`npm run dns\`.\n`;
  assert.deepEqual(checkOperationsDoc(fixture({ page })), [`${PAGE_PATH} cites \`automation/setup/gone.sh\`, which does not exist`]);
});

test('rule 5: a README with no link fails, and a link resolved from the wrong directory does not count', () => {
  const readmes = { 'README.md': 'Mentions `docs/operations.md` without linking it.\n', 'automation/README.md': '[ops](docs/operations.md)\n' };
  assert.deepEqual(checkOperationsDoc(fixture({ readmes })), [
    `README.md has no Markdown link to ${PAGE_PATH}`,
    `automation/README.md has no Markdown link to ${PAGE_PATH}`,
  ]);
});

test('rule 6: an old-name hit fails, in any letter case', () => {
  // Built from OLD_NAMES itself so this file never spells the name.
  const name = OLD_NAMES.source.split('|')[0].toUpperCase();
  assert.deepEqual(checkOperationsDoc(fixture({ page: `${PAGE}Formerly ${name}.\n` })), [
    `${PAGE_PATH} names the retired product or a folded tool (OLD_NAMES, ADR 0006)`,
  ]);
});

test('this test file names neither the retired product nor the folded tools', () => {
  assert.doesNotMatch(readFileSync(fileURLToPath(import.meta.url), 'utf8'), OLD_NAMES);
});
