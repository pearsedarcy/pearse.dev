// Asserts client case studies with clientPermission: pending are absent from the build.
// Builds once (npm run build) so the test can run alone.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HIDDEN = ['east-coast-blinds', 'dublinpleinair-crm'];

function htmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) htmlFiles(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

before(() => {
  execSync('npm run build', { stdio: 'pipe' });
});

test('no page directory for pending client case studies', () => {
  for (const slug of HIDDEN) assert.equal(existsSync(`dist/work/${slug}`), false, slug);
});

test('no href to pending case studies in any html', () => {
  for (const file of htmlFiles('dist')) {
    const html = readFileSync(file, 'utf8');
    for (const slug of HIDDEN) assert.equal(html.includes(`/work/${slug}`), false, `${file} links ${slug}`);
  }
});

test('pending case studies are absent from the sitemap', () => {
  const sitemap = readFileSync('dist/sitemap-0.xml', 'utf8');
  for (const slug of HIDDEN) assert.equal(sitemap.includes(slug), false, slug);
});

test('home grid still has six project cards', () => {
  // Selector: anchors with class "card" linking to /work/<slug>/ inside <section id="work">.
  const html = readFileSync('dist/index.html', 'utf8');
  const section = html.match(/<section id="work"[\s\S]*?<\/section>/)?.[0] ?? '';
  const cards = section.match(/<a [^>]*href="\/work\/[a-z0-9-]+\/"[^>]*>/g) ?? [];
  assert.equal(cards.filter((a) => /class="[^"]*\bcard\b/.test(a)).length, 6);
});
