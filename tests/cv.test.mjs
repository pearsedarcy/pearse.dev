// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const CV = 'dist/cv/index.html';
const html = () => readFileSync(CV, 'utf8');

/** Frontmatter fields the tests need, read straight from the case study files. */
function projects() {
  return readdirSync('src/content/projects')
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => {
      const fm = readFileSync(`src/content/projects/${f}`, 'utf8').split(/^---$/m)[1];
      const field = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '');
      const category = field('category');
      const permission = field('clientPermission') ?? 'pending';
      return {
        slug: field('slug'),
        title: field('title'),
        featured: field('featured') === 'true',
        pending: category === 'client' && permission === 'pending',
      };
    });
}

test('/cv/ is built', () => {
  assert.equal(existsSync(CV), true);
});

test('/cv/ carries no verify markers', () => {
  assert.equal(html().includes('[VERIFY'), false);
});

test('/cv/ never mentions pending client case studies', () => {
  const page = html();
  const pending = projects().filter((p) => p.pending);
  assert.ok(pending.length > 0, 'expected at least one pending client case study to guard against');
  for (const p of pending) {
    assert.equal(page.includes(p.slug), false, `slug ${p.slug}`);
    assert.equal(page.includes(p.title), false, `title ${p.title}`);
  }
});

test('/cv/ links every visible featured case study', () => {
  const page = html();
  const featured = projects().filter((p) => p.featured && !p.pending);
  assert.ok(featured.length > 0);
  for (const p of featured) assert.match(page, new RegExp(`href="/work/${p.slug}/"`), p.slug);
});

test('/cv/ has a print stylesheet', () => {
  const page = html();
  assert.ok(/<link[^>]+rel="stylesheet"[^>]+media="print"/.test(page) || /@media print/.test(page));
});

/** Contents of every `@media print { … }` block in the page, braces balanced. */
function printBlocks(page) {
  const out = [];
  for (const m of page.matchAll(/@media\s+print\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    while (i < page.length && depth > 0) {
      if (page[i] === '{') depth++;
      else if (page[i] === '}') depth--;
      i++;
    }
    out.push(page.slice(from, i - 1));
  }
  return out.join('\n');
}

test('/cv/ print stylesheet sets A4 and hides the nav header and footer', () => {
  const css = printBlocks(html());
  assert.match(css, /@page\s*\{[^}]*size:\s*A4/);
  for (const sel of ['header', 'footer']) {
    assert.match(css, new RegExp(`body\\s*>\\s*${sel}[^{]*\\{[^}]*display:\\s*none`), `body > ${sel} not hidden`);
  }
});

test('/cv/ case studies show no role and start-only periods', () => {
  const page = html();
  assert.equal(page.includes('Platform lead'), false);
  const periods = [...page.matchAll(/class="cv-period"[^>]*>([^<]*)</g)].map((m) => m[1]);
  // Experience and education rows keep their ranges; case-study rows must be a single start.
  const work = page.slice(page.indexOf('id="cv-work"'), page.indexOf('id="cv-skills"'));
  for (const m of work.matchAll(/class="cv-period"[^>]*>([^<]*)</g)) assert.doesNotMatch(m[1], /–/, m[1]);
  assert.ok(periods.length > 0);
});

test('/cv/ mailto matches SITE.email', () => {
  const email = readFileSync('src/lib/site.ts', 'utf8').match(/email:\s*'([^']+)'/)?.[1];
  assert.ok(email);
  const mailtos = [...html().matchAll(/href="mailto:([^"]+)"/g)].map((m) => m[1]);
  assert.ok(mailtos.length > 0, 'no mailto link');
  for (const m of mailtos) assert.equal(m, email);
});

test('/cv/ has a print button', () => {
  assert.match(html(), /<button[^>]*data-cv-print/);
});

test('sitemap lists /cv/', () => {
  assert.match(readFileSync('dist/sitemap-0.xml', 'utf8'), /https:\/\/pearse\.dev\/cv\//);
});

test('footer and About link to /cv/', () => {
  const home = readFileSync('dist/index.html', 'utf8');
  assert.match(home.slice(home.indexOf('<footer')), /href="\/cv\/"/);
  const about = home.match(/<section id="about"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(about, /href="\/cv\/"/);
});
