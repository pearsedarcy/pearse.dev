// ADR citations stay true (issue #139). Reads SOURCE files, not dist/: README.md,
// automation/README.md, automation/n8n/README.md and CLAUDE.md (for its decisions range).
// `npm test` still runs the pretest build; this suite ignores it.
// Every rule has a fixture below that proves it can fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adrLinks, audit, citedNumbers, frontmatterProblems, RUNBOOK_ADR, RUNBOOK_FILE } from './lib/adr-citations.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_FILES = ['README.md', 'automation/README.md', RUNBOOK_FILE, 'CLAUDE.md'];

const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8');
const sources = Object.fromEntries(SOURCE_FILES.map((f) => [f, read(f)]));
const adrs = Object.fromEntries(
  readdirSync(`${ROOT}docs/adr`).filter((f) => /^\d{4}-.*\.md$/.test(f)).map((f) => [f, read(`docs/adr/${f}`)]),
);
const exists = (p) => existsSync(`${ROOT}${p}`);

test('the repository has no ADR citation problems', () => {
  assert.deepEqual(audit({ sources, adrs, exists }), []);
});

test('the three source files are read and the runbook cites the incident ADR', () => {
  for (const f of ['README.md', 'automation/README.md', RUNBOOK_FILE]) assert.ok(sources[f].length > 0, f);
  assert.ok(citedNumbers(sources[RUNBOOK_FILE]).includes(RUNBOOK_ADR));
  assert.ok(citedNumbers(sources['automation/README.md']).includes(RUNBOOK_ADR), 'automation/README.md points at the runbook');
  assert.match(sources[RUNBOOK_FILE], /^## If a post goes wrong$/m);
});

test('the README names ADR links in the link form, so the link rule has something to check', () => {
  const links = adrLinks(sources['README.md'], 'README.md');
  assert.ok(links.length >= 2, `${links.length} ADR links`);
  for (const l of links) assert.ok(exists(l.path), l.path);
});

test('a status other than the usual values is not rejected: only presence is checked', () => {
  assert.deepEqual(frontmatterProblems('---\nstatus: whatever\ndate: soon\n---\n# T\n'), []);
});

// Fixtures: a tiny consistent world, then one breakage per rule.
const GOOD_ADRS = {
  '0001-a.md': '---\nstatus: accepted\ndate: 2026-01-01\n---\n# A\n',
  '0002-b.md': '---\nstatus: proposed\ndate: 2026-01-02\n---\n# B\n',
  '0013-c.md': '---\nstatus: proposed\ndate: 2026-01-03\n---\n# C\n',
};
const goodSources = () => ({
  'README.md': 'Decisions (0001 to 0013). See [ADR 0001](docs/adr/0001-a.md) and ADR 0002.',
  [RUNBOOK_FILE]: 'Steps cite ADR 0013 and [ADR 0002](../../docs/adr/0002-b.md).',
});
const fixtureExists = (p) => ['docs/adr/0001-a.md', 'docs/adr/0002-b.md', 'docs/adr/0013-c.md'].includes(p);
const run = (over = {}) => audit({ sources: goodSources(), adrs: GOOD_ADRS, exists: fixtureExists, ...over });

test('fixture: the consistent world passes', () => {
  assert.deepEqual(run(), []);
});

test('fixture: a citation of a missing ADR fails (bare form)', () => {
  const s = goodSources();
  s['README.md'] += ' Also ADR 0042.';
  assert.match(run({ sources: s }).join('\n'), /README\.md: ADR 0042 matches 0 files/);
});

test('fixture: two files with one number fail', () => {
  const dup = { ...GOOD_ADRS, '0002-other.md': GOOD_ADRS['0002-b.md'] };
  assert.match(run({ adrs: dup }).join('\n'), /ADR 0002 matches 2 files/);
});

test('fixture: a link whose target is missing fails (link form, relative to the citing file)', () => {
  const s = goodSources();
  s[RUNBOOK_FILE] += ' [ADR 0001](../../docs/adr/0001-gone.md)';
  assert.match(run({ sources: s }).join('\n'), /link target \.\.\/\.\.\/docs\/adr\/0001-gone\.md does not exist/);
});

test('fixture: link text that names a different ADR than its target fails', () => {
  const s = goodSources();
  s['README.md'] += ' [ADR 0002](docs/adr/0001-a.md)';
  assert.match(run({ sources: s }).join('\n'), /link text "ADR 0002" points at 0001-a\.md/);
});

test('fixture: an ADR without status, without date, or without frontmatter fails', () => {
  const bad = {
    ...GOOD_ADRS,
    '0001-a.md': '---\ndate: 2026-01-01\n---\n# A\n',
    '0002-b.md': '---\nstatus: proposed\ndate:\n---\n# B\n',
    '0013-c.md': '# C\n',
  };
  const out = run({ adrs: bad }).join('\n');
  assert.match(out, /0001-a\.md: frontmatter has no status/);
  assert.match(out, /0002-b\.md: frontmatter has no date/);
  assert.match(out, /0013-c\.md: no frontmatter/);
});

test('fixture: a stale decisions range fails', () => {
  const s = goodSources();
  s['README.md'] = s['README.md'].replace('0001 to 0013', '0001 to 0007');
  assert.match(run({ sources: s }).join('\n'), /says "0001 to 0007" but the newest ADR is 0013/);
});

test('fixture: a runbook that stops citing the incident ADR fails', () => {
  const s = goodSources();
  s[RUNBOOK_FILE] = 'Steps cite ADR 0002 only.';
  assert.match(run({ sources: s }).join('\n'), new RegExp(`does not cite ADR ${RUNBOOK_ADR}`));
});

test('fixture: a missing runbook fails', () => {
  const s = goodSources();
  delete s[RUNBOOK_FILE];
  assert.match(run({ sources: s }).join('\n'), /was not read/);
});
