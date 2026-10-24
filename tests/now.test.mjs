import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

before(() => {
  if (!existsSync('dist/now/index.html')) {
    const r = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
    assert.equal(r.status, 0, 'build failed');
  }
});

test('/now/ page has updated date and mailto link', () => {
  const html = readFileSync('dist/now/index.html', 'utf8');
  assert.match(html, /Updated /);
  assert.match(html, /href="mailto:pearse@pearse\.dev"/);
  assert.match(html, /href="https:\/\/nownownow\.com\/about"[^>]*rel="noopener"/);
});

test('sitemap lists /now/', () => {
  assert.match(readFileSync('dist/sitemap-0.xml', 'utf8'), /\/now\//);
});

test('footer on the home page links to /now/', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const footer = html.slice(html.indexOf('<footer'));
  assert.match(footer, /href="\/now\/"/);
});
