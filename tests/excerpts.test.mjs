// Asserts the source excerpts on the pearse.dev case study (#152): the pure extractor on inline
// fixtures, the three marked regions in the real files, and the built page (three labelled,
// keyboard-reachable, column-bound figures linking their exact lines on GitHub, in the right place
// on the page, with Shiki colours readable on the pre background). No other case study has one.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXCERPT_IDS, EXCERPT_MAX_LINES, EXCERPTS, excerptHref, extractExcerpt } from '../src/lib/excerpts.ts';
import { find, parseHtml, text } from './lib/html.mjs';
import { projects } from './lib/projects.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const ID = 'visibility-rules';
const fixture = (...lines) => lines.join('\n');
const extract = (src) => extractExcerpt(src, ID, 'fixture.ts');

// --- the extractor on fixtures ------------------------------------------------------------

test('extractExcerpt: returns the region, its 1-based line numbers and the dedented code', () => {
  const src = fixture(
    'function outer() {', // 1
    '  // excerpt:start visibility-rules', // 2
    '  if (a) {', // 3
    '    return b;', // 4
    '', // 5
    '  }', // 6
    '  // excerpt:end visibility-rules', // 7
    '}', // 8
  );
  assert.deepEqual(extract(src), { code: 'if (a) {\n  return b;\n\n}', startLine: 3, endLine: 6 });
});

test('extractExcerpt: ignores markers of other ids and reads CRLF files', () => {
  const src = '# excerpt:start other\r\n# excerpt:start visibility-rules\r\nx = 1\r\n# excerpt:end visibility-rules\r\n# excerpt:end other';
  assert.deepEqual(extract(src), { code: 'x = 1', startLine: 3, endLine: 3 });
});

test('extractExcerpt: every malformed region throws, naming the id and the path', () => {
  const bad = {
    'missing start': fixture('a', '// excerpt:end visibility-rules'),
    'missing end': fixture('// excerpt:start visibility-rules', 'a'),
    'duplicate start': fixture('// excerpt:start visibility-rules', 'a', '// excerpt:start visibility-rules', 'b', '// excerpt:end visibility-rules'),
    'duplicate end': fixture('// excerpt:start visibility-rules', 'a', '// excerpt:end visibility-rules', '// excerpt:end visibility-rules'),
    'end before start': fixture('// excerpt:end visibility-rules', 'a', '// excerpt:start visibility-rules'),
    'empty region': fixture('// excerpt:start visibility-rules', '// excerpt:end visibility-rules'),
    'blank region': fixture('// excerpt:start visibility-rules', '   ', '// excerpt:end visibility-rules'),
    '31-line region': fixture(
      '// excerpt:start visibility-rules',
      ...Array.from({ length: EXCERPT_MAX_LINES + 1 }, (_, i) => `line ${i}`),
      '// excerpt:end visibility-rules',
    ),
  };
  for (const [name, src] of Object.entries(bad)) {
    assert.throws(() => extract(src), (e) => e.message.includes('"visibility-rules"') && e.message.includes('fixture.ts'), name);
  }
});

test('extractExcerpt: a 30-line region is allowed; the cap is 30', () => {
  assert.equal(EXCERPT_MAX_LINES, 30);
  const src = fixture('// excerpt:start visibility-rules', ...Array.from({ length: 30 }, (_, i) => `line ${i}`), '// excerpt:end visibility-rules');
  assert.equal(extract(src).code.split('\n').length, 30);
});

test('excerptHref: pins a full commit id, otherwise falls back to master', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const repo = 'https://github.com/pearsedarcy/pearse.dev';
  assert.equal(excerptHref(repo, 'a/b.ts', 3, 9, sha), `${repo}/blob/${sha}/a/b.ts#L3-L9`);
  for (const s of [undefined, '', 'abc123', `${sha}\n`, 'refs/heads/x']) {
    assert.equal(excerptHref(repo, 'a/b.ts', 3, 9, s), `${repo}/blob/master/a/b.ts#L3-L9`, String(s));
  }
});

// --- the three real regions ---------------------------------------------------------------

const real = Object.fromEntries(
  EXCERPT_IDS.map((id) => {
    const source = readFileSync(EXCERPTS[id].path, 'utf8');
    return [id, { source, ...extractExcerpt(source, id) }];
  }),
);

test('every excerpt id has metadata and a marked region of 1 to 30 lines', () => {
  assert.deepEqual(Object.keys(EXCERPTS).sort(), [...EXCERPT_IDS].sort());
  for (const id of EXCERPT_IDS) {
    const { code, startLine, endLine } = real[id];
    const n = code.split('\n').length;
    assert.ok(n >= 1 && n <= EXCERPT_MAX_LINES, `${id}: ${n} lines`);
    assert.equal(endLine - startLine + 1, n, `${id}: line range matches the code`);
    assert.ok(EXCERPTS[id].caption.trim().length > 0, `${id}: caption`);
  }
});

test('each excerpt is lines startLine..endLine of the file on disk, before dedent', () => {
  for (const id of EXCERPT_IDS) {
    const { source, code, startLine, endLine } = real[id];
    const lines = source.split(/\r?\n/);
    assert.match(lines[startLine - 2], new RegExp(`excerpt:start ${id}\\s*$`), `${id}: start marker right above`);
    assert.match(lines[endLine], new RegExp(`excerpt:end ${id}\\s*$`), `${id}: end marker right below`);
    assert.match(lines[startLine - 3], /excerpt-sources/, `${id}: render note above the start marker`);
    const fileLines = lines.slice(startLine - 1, endLine);
    const codeLines = code.split('\n');
    const indents = fileLines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
    const cut = Math.min(...indents);
    assert.deepEqual(codeLines, fileLines.map((l) => (l.trim() ? l.slice(cut) : '')), id);
  }
});

test('each region holds what its caption claims, and nothing it must not', () => {
  const v = real['visibility-rules'].code;
  assert.match(v, /export function isPublishedPost\(/);
  assert.match(v, /export function isVisibleProject\(/);
  assert.match(v, /\n\}$/, 'visibility-rules ends at the closing brace of isVisibleProject');

  const g = real['gate-reporting'].code;
  assert.ok(g.includes('pattern #'), 'gate-reporting prints `pattern #n`');
  assert.ok(!g.includes('CONFIDENTIAL_PATTERNS'), 'no env var name');
  assert.ok(!/loadPatterns|readFileSync|\.confidential-patterns/.test(g), 'no pattern loading');
  assert.ok(!g.includes('FAILED'), 'no summary lines');

  const d = real['diagram-checks'].code;
  assert.ok(d.includes('overflows node'));
  assert.ok(d.includes('too short'));
  assert.ok(!d.includes('unknown node'));
});

// --- the built page -----------------------------------------------------------------------

const page = (slug) => readFileSync(`dist/work/${slug}/index.html`, 'utf8');
const html = page('pearse-dev');
const doc = parseHtml(html);
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
const HREF = /^https:\/\/github\.com\/pearsedarcy\/pearse\.dev\/blob\/([0-9a-f]{40}|master)\/(.+)#L(\d+)-L(\d+)$/;

test('the pearse.dev case study lists the three excerpts in its frontmatter', () => {
  const p = projects().find((x) => x.slug === 'pearse-dev');
  assert.deepEqual(p.excerpts, ['visibility-rules', 'gate-reporting', 'diagram-checks']);
});

test('/work/pearse-dev/ renders exactly three excerpt figures, one per id, in frontmatter order', () => {
  const figures = find(doc, (e) => e.tag === 'figure' && 'data-excerpt' in e.attrs);
  assert.deepEqual(
    figures.map((f) => f.attrs['data-excerpt']),
    ['visibility-rules', 'gate-reporting', 'diagram-checks'],
  );
  const section = find(doc, (e) => e.tag === 'section' && 'data-excerpts' in e.attrs);
  assert.equal(section.length, 1);
  assert.equal(section[0].attrs['aria-labelledby'], 'excerpts-title');
  assert.equal(find(section[0], (e) => e.tag === 'h2' && e.attrs.id === 'excerpts-title').length, 1);
});

test('each figure: captioned, linked to its exact lines, a labelled focusable scrolling pre', () => {
  for (const id of EXCERPT_IDS) {
    const [fig] = find(doc, (e) => e.tag === 'figure' && e.attrs['data-excerpt'] === id);
    assert.ok(fig, id);
    const captions = find(fig, (e) => e.tag === 'figcaption');
    assert.equal(captions.length, 1, `${id}: one figcaption`);
    const cap = captions[0];
    assert.equal(cap.attrs.id, `excerpt-${id}-caption`);
    assert.ok(decode(text(cap)).includes(EXCERPTS[id].caption), `${id}: caption text`);
    assert.ok(text(cap).includes(EXCERPTS[id].path), `${id}: repo path`);

    const links = find(cap, (e) => e.tag === 'a');
    assert.equal(links.length, 1, `${id}: one link`);
    const m = HREF.exec(decode(links[0].attrs.href));
    assert.ok(m, `${id}: href ${links[0].attrs.href}`);
    assert.equal(m[2], EXCERPTS[id].path);
    assert.equal(Number(m[3]), real[id].startLine, `${id}: start line`);
    assert.equal(Number(m[4]), real[id].endLine, `${id}: end line`);

    const pres = find(fig, (e) => e.tag === 'pre');
    assert.equal(pres.length, 1, `${id}: one pre`);
    const pre = pres[0];
    assert.equal(pre.attrs.tabindex, '0', `${id}: pre is focusable`);
    assert.equal(pre.attrs['aria-labelledby'], `excerpt-${id}-caption`);
    assert.match(pre.attrs.style ?? '', /overflow-x:\s*auto/, `${id}: pre scrolls on its own`);

    const firstLine = real[id].code.split('\n').find((l) => l.trim()).trim();
    assert.ok(decode(text(fig)).includes(firstLine), `${id}: shows "${firstLine}"`);
  }
});

test('the links all pin the same ref', () => {
  const refs = new Set(find(doc, (e) => e.tag === 'figure' && 'data-excerpt' in e.attrs).map((f) => HREF.exec(decode(find(f, (e) => e.tag === 'a')[0].attrs.href))[1]));
  assert.equal(refs.size, 1);
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA)) assert.deepEqual([...refs], [process.env.GITHUB_SHA]);
});

// WCAG relative luminance and contrast ratio, for Lighthouse's colour-contrast audit.
const lum = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every Shiki token colour reads at 4.5:1 or better on the pre background', () => {
  for (const id of EXCERPT_IDS) {
    const [fig] = find(doc, (e) => e.tag === 'figure' && e.attrs['data-excerpt'] === id);
    const [pre] = find(fig, (e) => e.tag === 'pre');
    const bg = /background-color:\s*#([0-9a-f]{6})/i.exec(pre.attrs.style)[1];
    const colours = new Set(
      find(pre, () => true)
        .concat([pre])
        .flatMap((e) => [.../(?:^|;)\s*color:\s*#([0-9a-f]{6})/gi.exec(e.attrs.style ?? '') ?? []].slice(1)),
    );
    assert.ok(colours.size > 1, `${id}: highlighted`);
    for (const c of colours) assert.ok(ratio(c, bg) >= 4.5, `${id}: #${c} on #${bg} is ${ratio(c, bg).toFixed(2)}:1`);
  }
});

test('page order: body, in-depth sections, excerpts, related writing, contact, case nav', () => {
  const at = (needle) => html.indexOf(needle);
  const excerpts = at('id="excerpts-title"');
  assert.ok(excerpts > 0);
  const body = at('aria-label="Notes"');
  assert.ok(body > 0 && body < excerpts, 'after the body');
  for (const before of ['id="sections-title"']) {
    if (at(before) !== -1) assert.ok(at(before) < excerpts, `after ${before}`);
  }
  for (const after of ['id="related-title"', 'data-case-contact', '<nav class="case-nav']) {
    if (at(after) !== -1) assert.ok(excerpts < at(after), `before ${after}`);
  }
});

test('no other built case study has an excerpt', () => {
  const others = projects().filter((p) => p.caseStudy && p.slug !== 'pearse-dev');
  assert.ok(others.length >= 8);
  for (const p of others) {
    const h = page(p.slug);
    assert.ok(!h.includes('data-excerpt'), `${p.slug}: no excerpt`);
    assert.ok(!h.includes('excerpts-title'), `${p.slug}: no excerpts heading`);
  }
});

test('Lighthouse audits /work/pearse-dev/, so the excerpt colours are checked in CI', () => {
  const rc = JSON.parse(readFileSync('lighthouserc.json', 'utf8'));
  assert.ok(rc.ci.collect.url.includes('http://localhost/work/pearse-dev/'));
});
