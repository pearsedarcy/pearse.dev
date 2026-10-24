import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const gate = resolve('scripts/gate.mjs');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'index.html'), '<p>hello PlantedSecret123 world</p>');
  return dir;
}

function run(dir, patterns) {
  const env = { ...process.env, GITHUB_ACTIONS: '' };
  delete env.CONFIDENTIAL_PATTERNS;
  if (patterns !== undefined) env.CONFIDENTIAL_PATTERNS = patterns;
  return spawnSync(process.execPath, [gate], { cwd: dir, env, encoding: 'utf8' });
}

test('hit fails, names the file and pattern index, not the text', () => {
  const dir = fixture();
  try {
    const r = run(dir, '# comment\n\nplantedsecret123\n');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /dist[\\/]index\.html: pattern #1/);
    assert.doesNotMatch(r.stdout.toLowerCase(), /plantedsecret123/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no patterns passes with a warning', () => {
  const dir = fixture();
  try {
    const r = run(dir, '');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NO PATTERNS CONFIGURED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-matching pattern passes', () => {
  const dir = fixture();
  try {
    const r = run(dir, 'nothingmatchesthis');
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /pattern #/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing dist fails with a clear message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  try {
    const r = run(dir, 'anything');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /dist\/ not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scans files with unusual or no extension, skips binaries', () => {
  const dir = fixture();
  try {
    writeFileSync(join(dir, 'dist', '_redirects'), '/old /plantedredirect9 301');
    writeFileSync(join(dir, 'dist', 'a.ics'), 'SUMMARY:plantedcal8');
    writeFileSync(join(dir, 'dist', 'b.png'), 'plantedpng7');
    writeFileSync(join(dir, 'dist', 'blob'), Buffer.from('plantedblob6\0\0'));
    for (const [pat, file] of [['plantedredirect9', '_redirects'], ['plantedcal8', 'a.ics']]) {
      const r = run(dir, pat);
      assert.equal(r.status, 1);
      assert.match(r.stdout, new RegExp(file.replace('.', '\\.')));
    }
    assert.equal(run(dir, 'plantedpng7').status, 0);
    assert.equal(run(dir, 'plantedblob6').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('anchored patterns match mid-file lines', () => {
  const dir = fixture();
  try {
    writeFileSync(join(dir, 'dist', 'x.txt'), 'first\nplantedline5\nlast');
    assert.equal(run(dir, '^plantedline5$').status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
