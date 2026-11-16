// No test or script rolls its own HTML or URL sanitiser (#345). CodeQL kept flagging the same three
// shapes in new tests (js/bad-tag-filter, js/incomplete-multi-character-sanitization, js/double-escaping,
// js/incomplete-url-substring-sanitization; #250, #315): a tag-stripping pattern, a chain of `.replace(`
// calls over entities, and a `.includes('http...')` host check. tests/lib/sanitise.mjs is the one place
// that does these properly, so this suite reads every source file under tests/ and scripts/ and fails
// with the helper to use. It never needs a CodeQL suppression, and an alert is never dismissed.
// Reads sources only (no dist/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELPER = 'tests/lib/sanitise.mjs';
const SELF = 'tests/no-adhoc-sanitisers.test.mjs';

/** Genuine exceptions, as `path` or `path:line`. Empty: a new entry needs its reason argued in review. */
const ALLOWLIST = new Set();

/**
 * Patterns that predate this guard and that CodeQL does not alert on, as `path: count`. This is a
 * ratchet, not an allowlist: a file may not gain a finding, and when one is migrated to the helpers
 * its count must go down here (the second test fails until it does). Never add a file or raise a count.
 */
const LEGACY = {
  'scripts/dns-check.mjs': 1,
  'scripts/og-pages.mjs': 1,
  'tests/bio.test.mjs': 4,
  'tests/cv.test.mjs': 2,
  'tests/east-coast-blinds-case.test.mjs': 6,
  'tests/east-coast-blinds-story.test.mjs': 1,
  'tests/excerpts.test.mjs': 6,
  'tests/figures.test.mjs': 1,
  'tests/github.test.mjs': 6,
  'tests/lib/diagrams.mjs': 3,
  'tests/mailto.test.mjs': 7,
  'tests/marquee-focus.test.mjs': 1,
  'tests/motion-gate.test.mjs': 1,
  'tests/mts-products.test.mjs': 4,
  'tests/ongoing-periods.test.mjs': 2,
  'tests/outcomes.test.mjs': 2,
  'tests/privacy.test.mjs': 1,
  'tests/scheduler.test.mjs': 1,
  'tests/series.test.mjs': 3,
  'tests/stack-toggle.test.mjs': 1,
  'tests/timeline.test.mjs': 3,
  'tests/visibility.test.mjs': 1,
  'tests/writing-topics.test.mjs': 1,
};

// A regex literal starts after one of these, which keeps a `//` comment out of the matches. The
// patterns are written with escaped brackets so this file does not contain what it looks for.
const LITERAL = String.raw`(?<=[(=,:[!&|?]\s*)\/(?:[^/\n\\]|\\.)*`;
const RULES = [
  {
    name: 'a tag-stripping or tag-matching regex',
    use: 'stripTags / textOf, or find(parseHtml(src), ...) with text() from tests/lib/html.mjs',
    // `<[^>` inside a regex literal, or a literal that matches a whole <script>/<style> element.
    re: new RegExp(String.raw`${LITERAL}(?:<\[\^>|<\/?(?:script|style)\b)(?:[^/\n\\]|\\.)*\/[a-z]*`, 'g'),
  },
  {
    name: 'a `.replace(` over an HTML entity',
    use: 'decodeEntities (one pass), or textOf',
    re: /\.replace(?:All)?\(\s*(?:\/|['"`])[^\n]*?&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi,
  },
  {
    name: 'a substring check on a URL (`.includes`, `.indexOf` or `.startsWith` of an http literal)',
    use: 'isHost, isHostOrSubdomain, mentionsHost or hasUrl',
    re: /\.(?:includes|indexOf|startsWith)\(\s*['"`]https?:/g,
  },
];

/** Every flagged `{ rule, line, text }` in `source`. */
export function findAdhocSanitisers(source) {
  const found = [];
  for (const rule of RULES) {
    const lines = new Set();
    for (const m of source.matchAll(rule.re)) {
      const line = source.slice(0, m.index).split('\n').length;
      if (lines.has(line)) continue; // one finding per rule per line
      lines.add(line);
      found.push({ rule, line, text: source.split('\n')[line - 1].trim() });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

function sourcesUnder(dir) {
  return readdirSync(`${ROOT}${dir}`, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(?:mjs|cjs|js|ts)$/.test(e.name))
    .map((e) => relative(ROOT, `${e.parentPath}/${e.name}`).split(sep).join('/'));
}

const files = [...sourcesUnder('tests'), ...sourcesUnder('scripts')].filter((f) => f !== HELPER && f !== SELF);

const hitsIn = (file) =>
  findAdhocSanitisers(readFileSync(`${ROOT}${file}`, 'utf8')).filter((h) => !ALLOWLIST.has(file) && !ALLOWLIST.has(`${file}:${h.line}`));
const describe = (file, h) => `${file}:${h.line}  ${h.rule.name}\n    ${h.text}\n    use ${h.rule.use} from ${HELPER}`;

test('the guard scans the tests and scripts, and exempts only the helper and itself', () => {
  assert.ok(files.length > 50, `${files.length} files scanned`);
  assert.ok(files.includes('tests/sanitise.test.mjs'), 'the helper\'s own suite is scanned');
  assert.ok(files.includes('scripts/gate.mjs'), 'scripts/ is scanned');
  assert.equal(files.includes(HELPER), false);
  assert.equal(files.includes(SELF), false, 'the fixtures below are findings by design');
});

test('no test or script strips tags, decodes entities or checks a host by hand (#345)', () => {
  const failures = [];
  for (const file of files) {
    const hits = hitsIn(file);
    if (hits.length > (LEGACY[file] ?? 0)) failures.push(...hits.map((h) => describe(file, h)));
  }
  assert.deepEqual(failures, [], `ad-hoc sanitisers found (the file may not gain one):\n${failures.join('\n')}`);
});

test('LEGACY only shrinks: a migrated file gives up its count', () => {
  for (const [file, count] of Object.entries(LEGACY)) {
    assert.ok(files.includes(file), `${file} is not a scanned file`);
    assert.equal(hitsIn(file).length, count, `${file} now has ${hitsIn(file).length} findings: set its LEGACY count to that, or delete the entry at 0`);
  }
});

test('every allowlist entry names a scanned file', () => {
  for (const entry of ALLOWLIST) assert.ok(files.includes(entry.replace(/:\d+$/, '')), `${entry} is not a scanned file`);
});

// What CodeQL flagged, rebuilt from parts so the fixtures are not themselves findings.
const join = (...parts) => parts.join('');
const FLAGGED = {
  'a tag-stripping regex': join("const t = html.replace(/", '<', '[^>]+', ">/g, '');"),
  'a tag-stripping regex with a star': join("x = s.replace(/", '<', '[^>]*', ">/g, ' ');"),
  'a script-element regex': join('const m = html.match(/', '<script>', '([\\s\\S]*?)', '<\\/script>', '/);'),
  'a script-element regex with attributes': join('html.matchAll(/', '<script\\b[^>]*>', '([\\s\\S]*?)', '<\\/script>/g)'),
  'a style-element regex': join('src.match(/', '<style', '[^>]*>([\\s\\S]*?)', '<\\/style>/)'),
  'an entity replace chain': join("s.replace(/", '&amp;', "/g, '&').replace(/", '&lt;', "/g, '<')"),
  'an entity replace with a string': join("s.replaceAll('", '&quot;', "', '\"')"),
  'a numeric entity replace': join('s.replace(/', '&#39;', "/g, \"'\")"),
  'an includes host check': join("assert.ok(href.includes('", 'https://github.com', "'))"),
  'an indexOf host check': join("href.indexOf(\"", 'http://example.test', "\") === 0"),
  'a startsWith host check': join('href.startsWith(`', 'https://github.com/', '${owner}`)'),
};

for (const [label, source] of Object.entries(FLAGGED)) {
  test(`the guard flags ${label}`, () => {
    const hits = findAdhocSanitisers(`import x from 'y';\n${source}\n`);
    assert.equal(hits.length, 1, JSON.stringify(hits.map((h) => h.rule.name)));
    assert.equal(hits[0].line, 2);
    assert.match(hits[0].rule.use, /stripTags|textOf|decodeEntities|isHost|hasUrl|find\(parseHtml/);
  });
}

test('the guard leaves the sanctioned forms alone', () => {
  const clean = [
    "import { textOf, hasUrl, isHost, decodeEntities } from './lib/sanitise.mjs';",
    "const words = textOf(note);",
    "assert.ok(hasUrl(body, 'https://pearse.dev/work/'));",
    "assert.equal(isHost(href, 'github.com'), true);",
    "const slug = title.replace(/\\s+/g, '-').toLowerCase();",
    "const hrefs = [...html.matchAll(/href=\"([^\"]*)\"/g)].map((m) => m[1]);",
    "assert.ok(src.includes('data-astro-cid'));",
    "const n = path.startsWith('/work/');",
  ].join('\n');
  assert.deepEqual(findAdhocSanitisers(clean), []);
});
