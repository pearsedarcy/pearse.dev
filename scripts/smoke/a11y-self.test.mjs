// Self-test for the accessibility scan (npm run a11y:self). It runs scripts/smoke/a11y.mjs over
// the fixture in scripts/smoke/a11y-fixture/ (one page: an image without alt, a low-contrast
// paragraph and an unguarded infinite CSS animation) with the 404 and ?nogl extras off, and
// checks that the scan fails for the right reasons, finishes despite the animation, honours
// exclusions and rejects an unused one.
// Not part of `npm test`, which only reads dist/ and needs no browser.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EXCLUSIONS, validateExclusions } from './a11y-exclusions.mjs';

const HERE = import.meta.dirname;
const FIXTURE = join(HERE, 'a11y-fixture');
const ENTRY = (rule, selector, issue = '#1') => ({ rule, selector, issue, reason: 'fixture' });

function scan(dir, exclusionList) {
  const args = [join(HERE, 'a11y.mjs'), '--dist', FIXTURE, '--out', join(dir, 'out'), '--no-extras'];
  if (exclusionList) {
    const file = join(dir, 'exclusions.mjs');
    writeFileSync(file, `export const EXCLUSIONS = ${JSON.stringify(exclusionList)};\n`);
    args.push('--exclusions', file);
  }
  const started = Date.now();
  // A hang on the infinite animation shows as a null status (killed by the timeout).
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 90_000 });
  const output = run.stdout + run.stderr;
  return { run, output, seconds: (Date.now() - started) / 1000 };
}

test('the scan fails on the fixture, names both rules at both viewports and finishes despite the infinite animation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-self-'));
  try {
    const { run, output, seconds } = scan(dir);
    assert.equal(run.signal, null, `the scan hung or was killed:\n${output}`);
    assert.equal(run.status, 1, `expected a failing run:\n${output}`);
    assert.ok(seconds < 60, `the scan took ${seconds} s`);
    assert.match(output, /a11y: 1 URLs \(1 in the sitemap\) x 2 viewports = 2 scans/);
    assert.match(output, /a11y: 2 scans, 4 violations, \d+ incomplete, [\d.]+ s \(FAILED\)/);

    const { scans } = JSON.parse(readFileSync(join(dir, 'out', 'report.json'), 'utf8'));
    assert.deepEqual(scans.map((s) => s.viewport), ['390x844', '1440x900']);
    for (const s of scans) {
      const ids = s.violations.map((v) => v.id).sort();
      assert.deepEqual(ids, ['color-contrast', 'image-alt'], `${s.viewport}: unexpected violations:\n${output}`);
      assert.ok(Array.isArray(s.incomplete), 'every scan carries an incomplete array');
      assert.match(output, new RegExp(`^a11y FAIL ${s.viewport} /page/ violations=2$`, 'm'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exclusions covering both rules make the run pass, and one that matches nothing fails it as unused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-self-'));
  try {
    const covered = [ENTRY('image-alt', '#no-alt'), ENTRY('color-contrast', '#low')];
    const ok = scan(dir, covered);
    assert.equal(ok.run.status, 0, `expected a passing run:\n${ok.output}`);
    assert.equal((ok.output.match(/^a11y ok /gm) ?? []).length, 2, ok.output);

    const stale = scan(dir, [...covered, ENTRY('label', '#nothing-here', '#2')]);
    assert.equal(stale.run.status, 1, `an unused exclusion must fail the run:\n${stale.output}`);
    assert.match(stale.output, /a11y FAIL unused exclusion: label #nothing-here \(#2\)/);
    assert.equal((stale.output.match(/^a11y ok /gm) ?? []).length, 2, 'the scans themselves still pass');

    // An exclusion covers its own rule only: dropping the contrast entry brings that rule back.
    const partial = scan(dir, [covered[0]]);
    assert.equal(partial.run.status, 1);
    const { scans } = JSON.parse(readFileSync(join(dir, 'out', 'report.json'), 'utf8'));
    for (const s of scans) assert.deepEqual(s.violations.map((v) => v.id), ['color-contrast']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateExclusions rejects malformed entries and whole-page selectors', () => {
  assert.doesNotThrow(() => validateExclusions([ENTRY('image-alt', 'img.hero')]));
  assert.throws(() => validateExclusions([ENTRY('image-alt', 'img', 'TODO')]), /must match/);
  assert.throws(() => validateExclusions([{ rule: 'image-alt', selector: 'img', issue: '#1' }]), /"reason"/);
  for (const selector of ['body', 'main', 'html', '*', ':root']) {
    assert.throws(() => validateExclusions([ENTRY('image-alt', selector)]), /whole page/, selector);
  }
});

test('every entry in the real exclusion list names an issue', () => {
  validateExclusions(EXCLUSIONS);
  for (const e of EXCLUSIONS) assert.match(e.issue, /^#\d+$/);
});
