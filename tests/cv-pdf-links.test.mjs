// scripts/cv-pdf.mjs must never leave a link to a missing PDF on either page that carries one
// (/cv/ and the home hero, #261). Runs the real script over a temporary dist/ with no Chrome:
// CHROME_PATH and PATH point at nothing, so it takes the "no Chrome, not CI" path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/cv-pdf.mjs');
const LINK = '<a class="btn" href="/pearse-darcy-cv.pdf" download="pearse-darcy-cv.pdf" data-cv-pdf>Download CV</a>';

function runWithoutChrome(pages, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cv-pdf-links-'));
  for (const [path, html] of Object.entries(pages)) {
    mkdirSync(dirname(join(dir, 'dist', path)), { recursive: true });
    writeFileSync(join(dir, 'dist', path), html);
  }
  const env = { PATH: dirname(process.execPath), CHROME_PATH: '/nonexistent', CV_PDF_DIST: join(dir, 'dist'), CV_PDF_STATUS: join(dir, 'status.json'), ...extraEnv };
  const run = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  const read = (p) => readFileSync(join(dir, 'dist', p), 'utf8');
  return { run, read, status: () => JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('with no Chrome the link is removed from /cv/ and from the home hero (#261)', () => {
  const t = runWithoutChrome({
    'cv/index.html': `<main><p>CV</p>${LINK.replace('btn', 'btn btn-lime cv-screen')}<button data-cv-print>Print</button></main>`,
    'index.html': `<section><div class="hero-ctas"><a class="btn" href="#contact">Get in touch</a>${LINK}</div></section>`,
  });
  try {
    assert.equal(t.run.status, 0, t.run.stderr);
    for (const p of ['cv/index.html', 'index.html']) assert.equal(t.read(p).includes('data-cv-pdf'), false, p);
    assert.match(t.read('index.html'), /Get in touch<\/a><\/div>/, 'the other CTA stays');
    assert.match(t.read('cv/index.html'), /data-cv-print/, 'Print stays');
    assert.equal(t.status().pdf, false);
  } finally {
    t.done();
  }
});

test('the script throws if a data-cv-pdf element survives on the home page (#261)', () => {
  // Not an anchor, so the removal regex cannot match it and the guard must fire.
  const t = runWithoutChrome({
    'cv/index.html': `<main>${LINK}</main>`,
    'index.html': '<section><span data-cv-pdf>x</span></section>',
  });
  try {
    assert.notEqual(t.run.status, 0);
    assert.match(t.run.stderr, /could not remove the data-cv-pdf link from index\.html/);
  } finally {
    t.done();
  }
});
