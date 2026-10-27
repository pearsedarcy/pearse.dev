// Asserts the MTS case studies render their accessible architecture diagrams (one under the
// facts, plus one per feature section that names a diagram), that diagrams carry nothing
// confidential-looking, and that other case studies have none.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pendingSlugs } from './lib/projects.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

// Pending client case studies, derived from the source files (none today).
const HIDDEN = pendingSlugs();
// Case study -> diagram ids on its page, in page order: the main one, then feature sections'.
const DIAGRAMS = {
  'mts-hub': ['diagram-mts-hub', 'diagram-knowledge'],
  'wetlabs-app': ['diagram-wetlabs-app', 'diagram-observability'],
};
// Case studies with no `diagram:` key.
const WITHOUT = ['agentic-workflow', 'mx-creative-keypad'];

const page = (slug) => readFileSync(`dist/work/${slug}/index.html`, 'utf8');
const imgSvgs = (html) => html.match(/<svg\b[^>]*\brole="img"[^>]*>/g) ?? [];

/** Every outer diagram <svg>…</svg> on the page, nested views included, in page order. */
function diagramSvgs(html) {
  const out = [];
  const open = /<svg\b[^>]*\brole="img"/g;
  for (let o; (o = open.exec(html)); ) {
    const tag = /<svg\b|<\/svg>/g;
    tag.lastIndex = o.index;
    let depth = 0;
    let end = -1;
    for (let m; (m = tag.exec(html)); ) {
      depth += m[0] === '</svg>' ? -1 : 1;
      if (depth === 0) {
        end = tag.lastIndex;
        break;
      }
    }
    assert.notEqual(end, -1, 'unterminated diagram svg');
    out.push(html.slice(o.index, end));
    open.lastIndex = end;
  }
  return out;
}

const textOf = (svg) =>
  svg
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

for (const [slug, ids] of Object.entries(DIAGRAMS)) {
  test(`${slug}: renders exactly its diagrams, in order`, () => {
    const svgs = diagramSvgs(page(slug));
    assert.equal(imgSvgs(page(slug)).length, ids.length);
    assert.deepEqual(
      svgs.map((svg) => svg.match(/aria-labelledby="([^"]+)-title"/)?.[1]),
      ids,
    );
  });

  for (const [n, svg] of diagramSvgs(page(slug)).entries()) checkDiagram(`${slug} #${n + 1}`, svg);
}

function checkDiagram(name, svg) {
  test(`${name}: diagram svg has a title and a description`, () => {
    const title = svg.match(/<title\b[^>]*>([^<]*)<\/title>/)?.[1].trim();
    const desc = svg.match(/<desc\b[^>]*>([^<]*)<\/desc>/)?.[1].trim();
    assert.ok(title, 'empty <title>');
    assert.ok(desc && desc.length > 40, 'missing or thin <desc>');
    const labelId = svg.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(labelId, 'no aria-labelledby');
    assert.match(svg, new RegExp(`<title id="${labelId}"`));
    const descId = svg.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(descId, 'no aria-describedby');
    assert.match(svg, new RegExp(`<desc id="${descId}"`));
  });

  test(`${name}: diagram text has no IP address, hostname or hidden client`, () => {
    const text = textOf(svg);
    assert.ok(text.length > 100, 'diagram has no text');
    assert.doesNotMatch(text, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'IPv4-like address');
    assert.doesNotMatch(text, /\b[a-z0-9-]+\.(?:com|app|net|io|dev|org|eu|local|ts\.net)\b/i, 'hostname-like text');
    for (const hidden of HIDDEN) assert.equal(text.toLowerCase().includes(hidden), false, hidden);
  });
}

/** Text of every stylesheet the page uses: inline <style> blocks and linked /_astro/*.css files. */
function pageCss(html) {
  const inline = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/g) ?? []).join('\n');
  const linked = (html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) ?? [])
    .map((tag) => tag.match(/href="\/([^"]+\.css)"/)?.[1])
    .filter(Boolean)
    .map((href) => readFileSync(`dist/${href}`, 'utf8'));
  return [inline, ...linked].join('\n');
}

test('diagram flow animation is limited to no-preference motion', () => {
  const css = pageCss(page('mts-hub')).replace(/\s+/g, ' ');
  // The animation must sit inside the no-preference query, so reduced motion gets static edges.
  const block = css.match(/@media \(prefers-reduced-motion: ?no-preference\) ?\{[^@]*?\.edge-flow[^}]*animation:[^}]*\}/);
  assert.ok(block, 'no reduced-motion guard around the flow animation');
  const outside = css.replace(block[0], '');
  assert.doesNotMatch(outside, /\.edge-flow[^{]*\{[^}]*animation:/, 'flow animation outside the guard');
});

test('case studies without a diagram key render no diagram', () => {
  for (const slug of WITHOUT) {
    const html = page(slug);
    assert.equal(imgSvgs(html).length, 0, slug);
    assert.equal(html.includes('class="case-diagram"'), false, slug);
  }
});
