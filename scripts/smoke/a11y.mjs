/**
 * Accessibility scan over the built site (#151). One axe run per URL per viewport, in headless
 * Chrome through `playwright-core` and `@axe-core/playwright`, and any violation fails the run.
 *
 * Scanned: every `<loc>` in the sitemap, the 404 page (a made-up path, status 404 asserted) and
 * `/?nogl` (the poster hero), each at 390x844 and 1440x900. The count comes from the sitemap and
 * is printed, never hardcoded: posts publish by date. Redirect pages are not in the sitemap and
 * are never scanned or named.
 *
 * Every context emulates `prefers-reduced-motion: reduce`. GSAP's scroll reveals hold below-fold
 * `[data-reveal]` items at opacity 0 until they scroll into view, and GSAP tweens are not Web
 * Animations, so without the emulation axe skips that content as hidden or catches it mid-tween.
 * Default-motion behaviour is the smoke run's job.
 *
 * Before each scan: `load`, `document.fonts.ready`, `data-hero-ready` on `/` and `/?nogl`, then the
 * page's finite Web Animations (looping ones, the marquee and the diagram flow edges, never
 * finish and are skipped) raced against a 5 s cap. No fixed sleeps.
 *
 * Rules: axe tags wcag2a, wcag2aa and best-practice (wcag22aa stays off until #105). The run keeps
 * going after a violation and exits 1 at the end. `incomplete` (needs review) never fails the run;
 * it is counted per rule. Exclusions (a11y-exclusions.mjs) are filtered per rule and per selector
 * after the scan; one that matches nothing fails the run.
 *
 * Usage: node scripts/smoke/a11y.mjs [--dist dist] [--out .smoke/a11y] [--exclusions <module>] [--no-extras]
 * `--no-extras` drops the 404 and `?nogl` scans (the self-test fixture has neither). The JSON
 * report goes to --out (gitignored `.smoke/`), which is emptied first.
 *
 * Output: only rule ids, impacts, selectors and help URLs, never page text.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { die, launchBrowser, requireChrome, sitemapPaths, stubExternal } from './harness.mjs';
import { serve } from './server.mjs';
import { EXCLUSIONS, validateExclusions } from './a11y-exclusions.mjs';

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1440x900', width: 1440, height: 900 },
];
const TAGS = ['wcag2a', 'wcag2aa', 'best-practice'];
/** Explicit timeouts (ms) for every wait. `settle` caps the wait for finite animations. */
const T = { nav: 15_000, ready: 10_000, settle: 5_000 };
/** A made-up path: the server answers it with the site's 404 page and status 404. */
const NOT_FOUND = '/404/';
const POSTER = '/?nogl';
const HERO_PAGES = new Set(['/', POSTER]);
/** Nodes listed per violation on the console. The JSON report keeps them all. */
const PRINT_NODES = 12;

const { values: args } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    out: { type: 'string', default: '.smoke/a11y' },
    exclusions: { type: 'string', default: '' },
    'no-extras': { type: 'boolean', default: false },
  },
});
const DIST = resolve(args.dist);
const OUT = resolve(args.out);

let exclusions;
try {
  const list = args.exclusions ? (await import(pathToFileURL(resolve(args.exclusions)).href)).EXCLUSIONS : EXCLUSIONS;
  exclusions = validateExclusions(list).map((e) => ({ ...e, matched: 0 }));
} catch (err) {
  die(`a11y: ${err.message}`);
}

const sitemap = sitemapPaths(DIST, 'a11y');
if (!sitemap.length) die('a11y: dist/sitemap-0.xml lists no URLs.');
const targets = [
  ...sitemap.map((path) => ({ path, status: 200 })),
  ...(args['no-extras'] ? [] : [{ path: NOT_FOUND, status: 404 }, { path: POSTER, status: 200 }]),
];

const chrome = requireChrome('a11y');
rmSync(OUT, { recursive: true, force: true });
const started = Date.now();
const server = await serve(DIST);
const browser = await launchBrowser(chrome);
console.log(`a11y: ${targets.length} URLs (${sitemap.length} in the sitemap) x ${VIEWPORTS.length} viewports = ${targets.length * VIEWPORTS.length} scans, Chrome ${chrome}`);

/** Wait until the page has stopped moving: fonts, the hero's mode (home only), finite animations. */
async function settle(page, path) {
  await page.waitForLoadState('load', { timeout: T.nav });
  if (HERO_PAGES.has(path)) await page.waitForSelector('#hero-3d[data-hero-ready]', { state: 'attached', timeout: T.ready });
  await page.evaluate(async (cap) => {
    await document.fonts.ready;
    // Looping animations (endTime Infinity) never resolve `finished`: leave them out.
    const finite = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime));
    // A cancelled animation rejects `finished`; that is settled too.
    const done = Promise.all(finite.map((a) => a.finished.then(() => {}, () => {})));
    let timer;
    const capped = new Promise((ok) => {
      timer = setTimeout(ok, cap);
    });
    await Promise.race([done, capped]);
    clearTimeout(timer);
  }, T.settle);
}

/**
 * Drop the nodes an exclusion covers (same rule, node is the selector or inside it) and the
 * violations left with no node. Counts each match on its entry.
 */
async function applyExclusions(page, violations) {
  const rules = new Set(exclusions.map((e) => e.rule));
  const candidates = [];
  for (const v of violations) {
    if (!rules.has(v.id)) continue;
    for (const node of v.nodes) {
      const target = node.target.length === 1 && typeof node.target[0] === 'string' ? node.target[0] : null;
      if (target) candidates.push({ v, node, target });
    }
  }
  if (!candidates.length) return violations;
  const probes = candidates.map((c) => ({ target: c.target, selectors: exclusions.filter((e) => e.rule === c.v.id).map((e) => e.selector) }));
  const hits = await page.evaluate(
    (list) =>
      list.map(({ target, selectors }) => {
        const el = document.querySelector(target);
        return selectors.map((sel) => {
          try {
            return !!el && !!el.closest(sel);
          } catch {
            return false;
          }
        });
      }),
    probes,
  );
  const covered = new Set();
  candidates.forEach((c, i) => {
    const rule = exclusions.filter((e) => e.rule === c.v.id);
    let matched = false;
    rule.forEach((e, j) => {
      if (hits[i][j]) {
        e.matched++;
        matched = true;
      }
    });
    if (matched) covered.add(c.node);
  });
  return violations.map((v) => ({ ...v, nodes: v.nodes.filter((n) => !covered.has(n)) })).filter((v) => v.nodes.length);
}

const scans = [];
const errors = [];
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await stubExternal(context, server.origin);
  for (const { path, status } of targets) {
    const scan = { viewport: viewport.name, path, violations: [], incomplete: [] };
    const page = await context.newPage();
    try {
      const response = await page.goto(server.origin + path, { waitUntil: 'load', timeout: T.nav });
      if (response?.status() !== status) throw new Error(`expected HTTP ${status}, got ${response?.status()}`);
      await settle(page, path);
      const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const violations = await applyExclusions(page, result.violations);
      scan.violations = violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => n.target.flat().join(' ')),
      }));
      scan.incomplete = result.incomplete.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length }));
    } catch (err) {
      scan.error = String(err.message).split('\n')[0].slice(0, 200);
      errors.push(scan);
    } finally {
      await page.close();
    }
    scans.push(scan);
    const label = `${scan.viewport} ${scan.path}`;
    if (scan.error) console.log(`a11y FAIL ${label} error=${scan.error}`);
    else if (scan.violations.length) {
      console.log(`a11y FAIL ${label} violations=${scan.violations.length}`);
      for (const v of scan.violations) {
        console.log(`  ${v.id} (${v.impact}) ${v.help} ${v.helpUrl}`);
        for (const target of v.nodes.slice(0, PRINT_NODES)) console.log(`    ${target}`);
        if (v.nodes.length > PRINT_NODES) console.log(`    +${v.nodes.length - PRINT_NODES} more in the report`);
      }
    } else console.log(`a11y ok ${label}`);
  }
  await context.close();
}
await browser.close();
await server.close();

const violationCount = scans.reduce((n, s) => n + s.violations.length, 0);
const incompleteCount = scans.reduce((n, s) => n + s.incomplete.length, 0);
const incompleteByRule = {};
for (const s of scans) for (const v of s.incomplete) incompleteByRule[v.id] = (incompleteByRule[v.id] ?? 0) + 1;
const unused = exclusions.filter((e) => !e.matched);
for (const e of unused) console.log(`a11y FAIL unused exclusion: ${e.rule} ${e.selector} (${e.issue}) matched nothing; delete it`);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const failed = violationCount > 0 || errors.length > 0 || unused.length > 0;

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, 'report.json'),
  JSON.stringify(
    {
      summary: { scans: scans.length, violations: violationCount, incomplete: incompleteCount, errors: errors.length, unusedExclusions: unused.length, seconds: Number(seconds) },
      incompleteByRule,
      exclusions: exclusions.map(({ rule, selector, issue, reason, matched }) => ({ rule, selector, issue, reason, matched })),
      scans,
    },
    null,
    2,
  ) + '\n',
);

const review = Object.entries(incompleteByRule).sort(([a], [b]) => a.localeCompare(b)).map(([id, n]) => `${id}=${n}`).join(' ');
console.log(`a11y incomplete (needs review, not failing): ${review || 'none'}`);
console.log(`a11y: ${scans.length} scans, ${violationCount} violations, ${incompleteCount} incomplete, ${seconds} s${failed ? ' (FAILED)' : ''}`);
process.exit(failed ? 1 : 0);
