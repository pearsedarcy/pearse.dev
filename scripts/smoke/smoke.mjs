/**
 * Browser smoke run over the built site (#119). Every other test reads `dist/` as text; this
 * one drives it in headless Chrome and fails on what a visitor would see go wrong.
 *
 * Checks, in order, one browser, one context per group, nothing in parallel:
 *   console      every sitemap URL loads with no console error, page error, failed or >= 400
 *                same-origin request (and no console warning outside the WebGL allowlist)
 *   transitions  from /, each primary Nav link: a cross-document view transition is not skipped,
 *                and at least one reports `done`
 *   redirects    from /, an in-page navigation into each redirect page reaches its target with
 *                the console clean (the #55 and #79 path)
 *   overflow     at 360, 320 and 305 px (320 less a classic scrollbar), no sitemap URL scrolls sideways,
 *                and no visible text ends inside the 16 px right gutter (#346)
 *   cards        on every page with an `a.card`, at seven widths from 390 to 1440 px, no element
 *                or text inside a card reaches past the card's border (#187)
 *   hero         `/?nogl`, `/?reduce` and `/` settle (`data-hero-ready`) into the right mode; `/?reduce`
 *                with no OS setting also stops the marquee and the letter reveal (#326)
 *   marquee      on `/?nogl`, tabbing through the hero marquee keeps every focused link on screen (#301)
 *   marquee      on `/`, under reduced motion at 390 and 1440 px: every word and link of the first copy
 *                sits inside the band, the aria-hidden copy has no box, no sideways scroll, no track
 *                animation; at 1440 px with default motion the track animates and both copies render (#269).
 *                At 390 px the static list keeps a 16 px side gutter, shows no "/" separators and stays
 *                under 40% of the viewport height (it was a 699 px wall, #349)
 *                Skipped when `/` has no `.marquee` (the self-test fixture)
 *
 * Usage: node scripts/smoke/smoke.mjs [--dist dist] [--out .smoke] [--skip hero,transitions]
 * Chrome comes from findChrome() (CHROME_PATH, then PATH). Exit 1 on any failure; the report and
 * screenshots go to --out (gitignored `.smoke/`), which is emptied first.
 *
 * Confidentiality: redirect pages live at old slugs. They are named only as `redirect #n -> <target>`,
 * every message is scrubbed of their paths, and nothing is captured on them.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { decode, die, launchBrowser, requireChrome, sitemapPaths, stubExternal } from './harness.mjs';
import { resolvePath, serve } from './server.mjs';

const CHECKS = ['console', 'transitions', 'redirects', 'overflow', 'cards', 'hero', 'marquee'];
/** 305 is 320 px less a 15 px classic scrollbar (#346). */
const WIDTHS = [360, 320, 305];
/** The side gutter (px) text must leave at every phone width: `.wrap` padding is clamp(1rem, 4vw, 3rem), 16 px up to 400 px (#346). */
const GUTTER = 16;
/** Phone, tablet, small laptop and desktop: #187 overflowed at 768, 1024 and 1080 only. */
const CARD_WIDTHS = [390, 768, 900, 1024, 1080, 1280, 1440];
const DESKTOP = { width: 1280, height: 800 };
/** Explicit timeouts (ms) for every wait. The redirect one must clear the 1 s meta refresh (#79). */
const T = { nav: 15_000, ready: 10_000, settle: 5_000, redirect: 10_000 };

/**
 * Console warnings that are not failures, matched by prefix. Warning type only: an `error`
 * message is never allowlisted. Each is noise from Chrome's software WebGL (SwiftShader, which
 * CI uses because the runner has no GPU), not from the site.
 */
const ALLOWED_WARNINGS = [
  // SwiftShader driver chatter, e.g. "[.WebGL-0x…]GL Driver Message (OpenGL, Performance, …): GPU stall due to ReadPixels".
  '[.WebGL-',
];

const { values: args } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    out: { type: 'string', default: '.smoke' },
    skip: { type: 'string', default: '' },
  },
});
const DIST = resolve(args.dist);
const OUT = resolve(args.out);
const skip = new Set(args.skip.split(',').filter(Boolean));
for (const s of skip) if (!CHECKS.includes(s)) die(`smoke: unknown check "${s}" in --skip (known: ${CHECKS.join(', ')})`);
const run = (check) => !skip.has(check);

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

/** Redirect pages: any built page with a meta refresh. The sitemap lists none of them. */
function redirectPages() {
  const found = [];
  for (const file of htmlFiles(DIST)) {
    const m = readFileSync(file, 'utf8').match(/<meta\s+http-equiv=["']?refresh["']?\s+content=["']?\s*\d+\s*;\s*url=([^"'>]+)/i);
    if (!m) continue;
    const rel = relative(DIST, file).split('\\').join('/');
    const from = '/' + rel.replace(/(^|\/)index\.html$/, '$1');
    const to = new URL(decode(m[1].trim()), `http://x${from}`);
    found.push({ from, to: to.pathname + to.search + to.hash });
  }
  return found.sort((a, b) => a.from.localeCompare(b.from)).map((r, i) => ({ ...r, index: i + 1, label: `redirect #${i + 1} -> ${r.to}` }));
}

/** Built filenames (in dist/_astro) of the chunks only the 3D hero should fetch. */
function heroChunks() {
  let files = [];
  try {
    files = readdirSync(join(DIST, '_astro'));
  } catch {
    // No _astro directory (the self-test fixture): the hero check is skipped there.
  }
  return { hero: files.filter((f) => /^hero\.[\w-]+\.js$/.test(f)), three: files.filter((f) => /^three\.module\.[\w-]+\.js$/.test(f)) };
}

const paths = sitemapPaths(DIST, 'smoke');
if (!paths.length) die('smoke: dist/sitemap-0.xml lists no URLs.');

/** Sitemap paths whose built page has an `a.card` (the home and /work/ grids on the real site). */
function cardPaths() {
  return paths.filter((path) => {
    const file = resolvePath(DIST, new URL(path, 'http://x').pathname);
    return file && /<a\b[^>]*\bclass="card[\s"]/.test(readFileSync(file, 'utf8'));
  });
}
const redirects = redirectPages();

/** Remove every redirect page's old path, and its last path segment, from text that leaves this script. */
function scrub(text) {
  let s = String(text);
  for (const r of redirects) {
    const slug = r.from.split('/').filter(Boolean).pop();
    s = s.split(r.from).join(`<redirect #${r.index}>`);
    if (slug) s = s.split(slug).join('<old slug>');
  }
  return s;
}

const failures = [];
const notes = [];
let shots = 0;
function fail(check, where, message) {
  const f = { check, where: scrub(where), message: scrub(message).replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 3).join(' | ').slice(0, 400) };
  failures.push(f);
  console.error(`FAIL [${f.check}] ${f.where}: ${f.message}`);
}

async function screenshot(page, name) {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${String(++shots).padStart(2, '0')}-${name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'root'}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
}

const chrome = requireChrome('smoke');

rmSync(OUT, { recursive: true, force: true });
const started = Date.now();
const server = await serve(DIST);
const { origin } = server;
const at = (path) => origin + path;
const local = (url) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};
const pathOf = (url) => {
  const u = new URL(url);
  return u.pathname + u.search + u.hash;
};

console.log(`smoke: ${paths.length} sitemap URLs, ${redirects.length} redirect pages, Chrome ${chrome}`);

const browser = await launchBrowser(chrome);

/**
 * A context with external requests stubbed, and a page whose console, errors and same-origin
 * request failures are reported against `where.current`.
 */
async function open(check, options = {}) {
  const context = await browser.newContext({ viewport: DESKTOP, ...options });
  await stubExternal(context, origin);
  const page = await context.newPage();
  const where = { current: '' };
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') fail(check, where.current, `console error: ${text}`);
    else if (msg.type() === 'warning' && !ALLOWED_WARNINGS.some((p) => text.startsWith(p))) fail(check, where.current, `console warning: ${text}`);
  });
  page.on('pageerror', (err) => fail(check, where.current, `page error: ${err.message}`));
  page.on('requestfailed', (req) => {
    if (local(req.url())) fail(check, where.current, `request failed: ${pathOf(req.url())} (${req.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('response', (res) => {
    if (local(res.url()) && res.status() >= 400) fail(check, where.current, `HTTP ${res.status()}: ${pathOf(res.url())}`);
  });
  return { context, page, where };
}

/** Load a page and let it go quiet: no request for 500 ms (Playwright's networkidle). */
const load = (page, path) => page.goto(at(path), { waitUntil: 'networkidle', timeout: T.nav });

/** Run one check's body; a thrown error (a timeout, a crash) is that check's failure. */
async function step(check, where, body) {
  try {
    await body();
  } catch (err) {
    fail(check, where, err.message);
  }
}

// 1. Console clean on every sitemap URL.
if (run('console')) {
  const { context, page, where } = await open('console');
  for (const path of paths) {
    where.current = path;
    await step('console', path, () => load(page, path));
  }
  await context.close();
}

// 2. Cross-document view transitions through the primary Nav.
if (run('transitions')) {
  const { context, page, where } = await open('transitions');
  // Registered before any page script. A skipped transition rejects `ready` (`finished` still
  // fulfils), so both are awaited: 'done' only when the transition really ran.
  await context.addInitScript(() => {
    addEventListener('pagereveal', (event) => {
      const vt = event.viewTransition;
      const settled = vt ? Promise.all([vt.ready, vt.finished]).then(() => 'done', () => 'skipped') : Promise.resolve('none');
      window.__smokeVT = settled;
      settled.then((v) => (window.__smokeVTResult = v));
    });
  });
  const counts = { done: 0, none: 0, skipped: 0, 'same-document': 0 };
  where.current = '/';
  let links = [];
  await step('transitions', '/', async () => {
    await load(page, '/');
    links = await page.locator('header nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  });
  if (!links.length) fail('transitions', '/', 'no primary Nav links (header nav a) found');
  for (const [i, href] of links.entries()) {
    const target = new URL(href, at('/')).href;
    where.current = `/ -> ${href}`;
    await step('transitions', where.current, async () => {
      await load(page, '/');
      await page.evaluate(() => delete window.__smokeVTResult);
      const sameDocument = new URL(target).pathname === '/' && new URL(target).search === '';
      await page.locator('header nav a').nth(i).click({ timeout: T.settle });
      await page.waitForURL(target, { timeout: T.nav });
      if (sameDocument) {
        counts['same-document']++;
        return;
      }
      const result = await (await page.waitForFunction(() => window.__smokeVTResult, null, { timeout: T.settle })).jsonValue();
      counts[result]++;
      if (result === 'skipped') fail('transitions', where.current, 'view transition was skipped');
    });
  }
  if (links.length && !counts.done) fail('transitions', 'Nav', 'no Nav hop reported viewTransition.finished as done: the transition check did not run');
  notes.push(`transitions: ${counts.done}/${links.length} Nav hops done (${counts.none} none, ${counts.skipped} skipped, ${counts['same-document']} same-document)`);
  await context.close();
}

// 3. Redirect pages, entered by an in-page navigation (renderer-initiated, unlike page.goto) so the
// cross-document transition really runs into them (#55). The page reports its own lifecycle: it must
// be revealed with a view transition, and that transition must finish before the meta refresh leaves.
// Leaving earlier is the #79 condition (Chrome then logs "AbortError: Transition was skipped" only
// sometimes), so it is asserted directly instead of waiting for the console to say so. Only
// `finished` is observed, never `ready`, so no rejection the browser would report gets handled here.
if (run('redirects') && redirects.length) {
  const { context, page, where } = await open('redirects');
  const seen = [];
  await context.exposeBinding('__smokeLifecycle', (_source, event) => seen.push(event));
  await context.addInitScript(() => {
    const report = (type, vt) => window.__smokeLifecycle({ path: location.pathname, type, vt });
    addEventListener('pagereveal', (event) => {
      report('reveal', Boolean(event.viewTransition));
      event.viewTransition?.finished.then(() => report('finished', true));
    });
    addEventListener('pageswap', () => report('swap', false));
  });
  for (const r of redirects) {
    where.current = r.label;
    await step('redirects', r.label, async () => {
      where.current = `${r.label} (from /)`;
      await load(page, '/');
      where.current = r.label;
      seen.length = 0;
      await page.evaluate((href) => {
        location.href = href;
      }, at(r.from));
      await page.waitForURL(at(r.to), { timeout: T.redirect, waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: T.nav });
      const on = seen.map((e, i) => ({ ...e, i })).filter((e) => e.path === r.from);
      const reveal = on.find((e) => e.type === 'reveal');
      const finished = on.find((e) => e.type === 'finished');
      const swap = on.find((e) => e.type === 'swap');
      if (!reveal) fail('redirects', r.label, 'the redirect page was never revealed: its refresh left before the incoming view transition (#79)');
      else if (!reveal.vt) fail('redirects', r.label, 'no cross-document view transition ran into the redirect page (#55 opt-in)');
      else if (!finished || (swap && swap.i < finished.i))
        fail('redirects', r.label, 'the refresh left while the incoming view transition was still running (#79 AbortError)');
    });
  }
  notes.push(`redirects: ${redirects.length} pages followed`);
  await context.close();
}

// 4. No sideways scroll at phone widths.
if (run('overflow')) {
  for (const width of WIDTHS) {
    const { context, page, where } = await open('overflow', { viewport: { width, height: 800 } });
    for (const path of paths) {
      where.current = `${path} @ ${width}px`;
      await step('overflow', where.current, async () => {
        await load(page, path);
        await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: T.settle });
        const over = await page.evaluate(() => {
          const de = document.documentElement;
          const cw = de.clientWidth;
          if (de.scrollWidth <= cw) return null;
          const clipped = (el) => {
            for (let p = el.parentElement; p && p !== document.body && p !== de; p = p.parentElement)
              if (getComputedStyle(p).overflowX !== 'visible') return true;
            return false;
          };
          let worst = null;
          let widest = -1;
          for (const el of document.body.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.right <= cw + 0.5 || clipped(el)) continue;
            if (r.width > widest) [worst, widest] = [el, r.width];
          }
          const selector = (el) => {
            const parts = [];
            for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
              let s = e.tagName.toLowerCase();
              if (e.id) {
                parts.unshift(`${s}#${CSS.escape(e.id)}`);
                break;
              }
              const cls = [...e.classList].slice(0, 2).map((c) => CSS.escape(c));
              if (cls.length) s += `.${cls.join('.')}`;
              parts.unshift(s);
            }
            return parts.join(' > ');
          };
          return { scrollWidth: de.scrollWidth, clientWidth: cw, selector: worst ? selector(worst) : '(no single element)', width: Math.round(widest) };
        });
        if (over) {
          fail('overflow', where.current, `scrollWidth ${over.scrollWidth} > clientWidth ${over.clientWidth}; widest offender ${over.selector} (${over.width}px)`);
          await screenshot(page, `overflow-${width}-${path}`);
        }
        // Text must also keep the gutter: a column that ends 1 px short of the edge does not scroll, but
        // "SURGEONS," touching the screen edge is the defect (#346). Two measures: the box of each text
        // block (a heading that clips its own words still has a box in the gutter) and the glyphs of each
        // text node. Anything inside a clipping ancestor (the marquee, a scrolling <pre>) is not measured.
        const gutter = await page.evaluate((min) => {
          const cw = document.documentElement.clientWidth;
          const limit = cw - min;
          const skip = (el) => {
            if (el.closest('script, style, noscript, [hidden], [aria-hidden="true"]')) return true;
            for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement)
              if (getComputedStyle(p).overflowX !== 'visible') return true;
            return getComputedStyle(el).visibility === 'hidden';
          };
          let worst = null;
          let past = 0;
          const note = (el, text, right) => {
            if (right <= limit + 0.5 || right - limit <= past) return;
            past = right - limit;
            const tag = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : el.classList.length ? `.${el.classList[0]}` : '');
            worst = { tag, text, right: Math.round(right), limit, cw };
          };
          for (const el of document.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dt, dd')) {
            const r = el.getBoundingClientRect();
            if (r.width && !skip(el)) note(el, (el.textContent ?? '').trim().slice(0, 24), r.right);
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.data.trim() || !n.parentElement || skip(n.parentElement)) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            const r = range.getBoundingClientRect();
            if (r.width) note(n.parentElement, n.data.trim().slice(0, 24), r.right);
          }
          return worst;
        }, GUTTER);
        if (gutter) {
          fail('overflow', where.current, `"${gutter.text}" in ${gutter.tag} ends at x=${gutter.right}, inside the ${GUTTER}px right gutter (limit ${gutter.limit} of ${gutter.cw})`);
          await screenshot(page, `gutter-${width}-${path}`);
        }
      });
    }
    await context.close();
  }
}

// 5. Card content inside its card (#187). Every element's box and every text run (a Range, so a
// long word overflowing a correctly sized heading still counts) must end inside the card's right
// border. An element clipped by an `overflow` ancestor inside the card is not visible past it.
if (run('cards')) {
  const pages = cardPaths();
  if (!pages.length) fail('cards', 'sitemap', 'no sitemap page has an a.card: the card check did not run');
  for (const width of CARD_WIDTHS) {
    const { context, page, where } = await open('cards', { viewport: { width, height: 900 } });
    for (const path of pages) {
      where.current = `${path} @ ${width}px`;
      await step('cards', where.current, async () => {
        await load(page, path);
        await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: T.settle });
        const over = await page.evaluate(() => {
          const out = [];
          for (const card of document.querySelectorAll('a.card')) {
            const edge = card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).borderRightWidth);
            const clipped = (el) => {
              for (let p = el.parentElement; p && p !== card; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true;
              return false;
            };
            let worst = null;
            const consider = (right, what) => {
              if (right > edge + 0.5 && (!worst || right > worst.right)) worst = { right, what };
            };
            for (const el of card.querySelectorAll('*')) {
              const r = el.getBoundingClientRect();
              if (!(r.width || r.height) || clipped(el)) continue;
              consider(r.right, el.tagName.toLowerCase() + [...el.classList].slice(0, 2).map((c) => `.${c}`).join(''));
            }
            const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
            for (let t = walker.nextNode(); t; t = walker.nextNode()) {
              if (!t.textContent.trim() || (t.parentElement !== card && clipped(t.parentElement))) continue;
              const range = document.createRange();
              range.selectNodeContents(t);
              for (const r of range.getClientRects()) consider(r.right, `text in ${t.parentElement.tagName.toLowerCase()}`);
            }
            if (worst) out.push({ card: card.getAttribute('href'), what: worst.what, by: Math.round(worst.right - edge) });
          }
          return out;
        });
        for (const o of over) fail('cards', where.current, `card ${o.card}: ${o.what} ends ${o.by}px past the card's right border`);
        if (over.length) await screenshot(page, `cards-${width}-${path}`);
      });
    }
    await context.close();
  }
  notes.push(`cards: ${pages.length} page(s) x ${CARD_WIDTHS.length} widths`);
}

// 6. Hero degraded paths on /. `data-hero-ready` is set only once the hero script has decided the mode.
if (run('hero')) {
  const chunks = heroChunks();
  const READY = '#hero-3d[data-hero-ready]';

  /** The h1 says the name: concatenated letter text equals its aria-label without whitespace. */
  async function lettersSpellName(page, where) {
    const { label, text } = await page.evaluate(() => {
      const h1 = document.querySelector('h1#hero-title');
      return {
        label: h1?.getAttribute('aria-label') ?? '',
        text: [...(h1?.querySelectorAll('.hero-letter') ?? [])].map((l) => l.textContent).join(''),
      };
    });
    if (!label || text !== label.replace(/\s+/g, '')) fail('hero', where, `hero letters "${text}" do not spell the h1 label "${label}"`);
  }
  async function lettersOpaque(page, where) {
    const notOpaque = await page.evaluate(() =>
      [...document.querySelectorAll('.hero-letter')].filter((l) => getComputedStyle(l).opacity !== '1').length,
    );
    if (notOpaque) fail('hero', where, `${notOpaque} .hero-letter element(s) not at opacity 1`);
  }

  if (!chunks.hero.length) fail('hero', '/', 'no hero.*.js chunk in dist/_astro: cannot check that ?nogl skips it');

  // ?nogl: poster, no 3D chunk fetched, poster shown and canvas hidden once transitions finish.
  {
    const where0 = '/?nogl';
    const { context, page, where } = await open('hero');
    where.current = where0;
    const requested = [];
    page.on('request', (req) => requested.push(new URL(req.url()).pathname.split('/').pop()));
    await step('hero', where0, async () => {
      await load(page, '/?nogl');
      await page.waitForSelector(READY, { state: 'attached', timeout: T.ready });
      const mode = await page.getAttribute('#hero-3d', 'data-mode');
      if (mode !== 'poster') fail('hero', where0, `data-mode is "${mode}", expected "poster"`);
      const fetched = [...chunks.hero, ...chunks.three].filter((c) => requested.includes(c));
      if (fetched.length) fail('hero', where0, `3D chunk requested: ${fetched.join(', ')}`);
      await page.waitForFunction(
        () => ['.hero-poster', '.hero-canvas'].every((s) => document.querySelector(`#hero-3d ${s}`)?.getAnimations().every((a) => a.playState === 'finished')),
        null,
        { timeout: T.settle },
      );
      const [poster, canvas] = await page.evaluate(() =>
        ['.hero-poster', '.hero-canvas'].map((s) => getComputedStyle(document.querySelector(`#hero-3d ${s}`)).opacity),
      );
      if (poster !== '1' || canvas !== '0') fail('hero', where0, `poster opacity ${poster}, canvas opacity ${canvas}; expected 1 and 0`);
      await lettersSpellName(page, where0);
    });
    if (failures.some((f) => f.where === where0)) await screenshot(page, 'hero-nogl');
    await context.close();
  }

  // ?reduce with prefers-reduced-motion emulated: the CSS letter reveal follows the media query.
  {
    const where0 = '/?reduce';
    const { context, page, where } = await open('hero', { reducedMotion: 'reduce' });
    where.current = where0;
    await step('hero', where0, async () => {
      await page.goto(at('/?reduce'), { waitUntil: 'load', timeout: T.nav });
      const running = await page.evaluate(
        () => [...document.querySelectorAll('.hero-letter')].filter((l) => l.getAnimations().some((a) => a.playState === 'running')).length,
      );
      if (running) fail('hero', where0, `${running} .hero-letter animation(s) running under reduced motion`);
      await lettersOpaque(page, where0);
      await page.waitForSelector(READY, { state: 'attached', timeout: T.ready });
      const mode = await page.getAttribute('#hero-3d', 'data-mode');
      if (mode !== 'poster') fail('hero', where0, `data-mode is "${mode}", expected "poster"`);
      await lettersSpellName(page, where0);
      await page.waitForLoadState('networkidle', { timeout: T.nav });
    });
    if (failures.some((f) => f.where === where0)) await screenshot(page, 'hero-reduce');
    await context.close();
  }

  // ?reduce alone, OS reduced motion off (#326): the override reaches the CSS too, through
  // `data-reduce` on <html>, so the marquee and the letter reveal do not run.
  {
    const where0 = '/?reduce (no OS setting)';
    const { context, page, where } = await open('hero', { reducedMotion: 'no-preference' });
    where.current = where0;
    await step('hero', where0, async () => {
      await page.goto(at('/?reduce'), { waitUntil: 'load', timeout: T.nav });
      const flagged = await page.evaluate(() => document.documentElement.hasAttribute('data-reduce'));
      if (!flagged) fail('hero', where0, '<html> has no data-reduce attribute');
      const running = await page.evaluate(() =>
        ['.hero-letter', '.marquee-track'].map((s) => [s, [...document.querySelectorAll(s)].filter((el) => el.getAnimations().some((a) => a.playState === 'running')).length]),
      );
      for (const [s, n] of running) if (n) fail('hero', where0, `${n} ${s} animation(s) running under ?reduce`);
      await lettersOpaque(page, where0);
      await page.waitForSelector(READY, { state: 'attached', timeout: T.ready });
      const mode = await page.getAttribute('#hero-3d', 'data-mode');
      if (mode !== 'poster') fail('hero', where0, `data-mode is "${mode}", expected "poster"`);
      await page.waitForLoadState('networkidle', { timeout: T.nav });
    });
    if (failures.some((f) => f.where === where0)) await screenshot(page, 'hero-reduce-override');
    await context.close();
  }

  // Default: settles (gl where software WebGL works, poster otherwise) with the console clean,
  // and the letter reveal ends with every letter shown.
  {
    const where0 = '/ (default hero)';
    const { context, page, where } = await open('hero');
    where.current = where0;
    await step('hero', where0, async () => {
      await load(page, '/');
      await page.waitForSelector(READY, { state: 'attached', timeout: T.ready });
      notes.push(`hero: default mode ${await page.getAttribute('#hero-3d', 'data-mode')}`);
      await page.waitForFunction(
        () => [...document.querySelectorAll('.hero-letter')].every((l) => l.getAnimations().every((a) => a.playState === 'finished')),
        null,
        { timeout: T.settle },
      );
      await lettersOpaque(page, where0);
      await lettersSpellName(page, where0);
      await page.waitForLoadState('networkidle', { timeout: T.nav });
    });
    if (failures.some((f) => f.where === where0)) await screenshot(page, 'hero-default');
    await context.close();
  }
}

// 7. Marquee keyboard focus on /?nogl (#301): every link in the tab order is on screen, outline included,
// when it takes focus, the drift stops while focus is inside, and leaving the band restores the start.
if (run('marquee')) {
  const where0 = '/ (marquee focus)';
  const { context, page, where } = await open('marquee');
  where.current = where0;
  await step('marquee', where0, async () => {
    await load(page, '/?nogl');
    const links = page.locator('.marquee-list:not([aria-hidden]) .marquee-link');
    const count = await links.count();
    if (count < 1) return fail('marquee', where0, 'no focusable marquee links');
    // Let the drift run first, so the offset is non-zero when the first link takes focus.
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.marquee-track')).transform !== 'none', null, { timeout: T.settle });
    await links.first().focus();
    for (let i = 0; i < count; i++) {
      const { word, left, right, width, name } = await page.evaluate(() => {
        const el = document.activeElement;
        const r = el.getBoundingClientRect();
        return { word: el.textContent.trim(), left: r.left, right: r.right, width: document.documentElement.clientWidth, name: getComputedStyle(el.closest('.marquee-track')).animationName };
      });
      if (left < 0 || right > width) fail('marquee', where0, `link ${i + 1} of ${count} is off screen when focused (${Math.round(left)}..${Math.round(right)} of ${width} px)`);
      if (name !== 'none') fail('marquee', where0, `link ${i + 1} of ${count}: the marquee still animates while focus is inside it`);
      if (i < count - 1) await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Tab');
    const after = await page.evaluate(() => ({ scroll: document.querySelector('.marquee').scrollLeft, name: getComputedStyle(document.querySelector('.marquee-track')).animationName }));
    if (after.scroll !== 0) fail('marquee', where0, `the marquee keeps scrollLeft ${after.scroll} after focus leaves`);
    if (after.name === 'none') fail('marquee', where0, 'the marquee does not resume after focus leaves');
    notes.push(`marquee: ${count} link(s) on screen when focused`);
  });
  if (failures.some((f) => f.where === where0)) await screenshot(page, 'marquee-focus');
  await context.close();
}

// 7. Marquee (#269). Reduced motion must show every word, wrapped, with no animation and no duplicate
// copy; default motion must still loop. Measured in a real browser: axe cannot see a clipped band.
// Emulates `reducedMotion` on the context: `?reduce` drives only the JS paths, not this media query.
if (run('marquee')) {
  const MARQUEE_VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ];
  // Pages with no `.marquee` (the self-test fixture) skip the check, as the hero check skips with no _astro/.
  const hasMarquee = (() => {
    try {
      return /class="marquee"/.test(readFileSync(join(DIST, 'index.html'), 'utf8'));
    } catch {
      return false;
    }
  })();

  /** Measurements taken in the page; judged in node so the messages stay readable. */
  const measure = (page) =>
    page.evaluate(() => {
      const band = document.querySelector('.marquee');
      const track = band?.querySelector('.marquee-track');
      const lists = [...(track?.querySelectorAll('.marquee-list') ?? [])];
      const first = lists.find((l) => l.getAttribute('aria-hidden') !== 'true');
      const copies = lists.filter((l) => l.getAttribute('aria-hidden') === 'true');
      const box = band.getBoundingClientRect();
      const outside = (els) =>
        els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width <= 0 || r.height <= 0 || r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5;
        }).length;
      const links = [...(first?.querySelectorAll('.marquee-link') ?? [])];
      const items = [...(first?.querySelectorAll('.marquee-item') ?? [])];
      const firstStyle = first ? getComputedStyle(first) : null;
      return {
        listHeight: first ? first.getBoundingClientRect().height : 0,
        gutter: firstStyle ? [parseFloat(firstStyle.paddingLeft), parseFloat(firstStyle.paddingRight)] : [0, 0],
        sepsShown: [...(first?.querySelectorAll('.marquee-sep') ?? [])].filter((el) => el.getClientRects().length > 0).length,
        innerHeight: window.innerHeight,
        lists: lists.length,
        links: links.length,
        items: items.length,
        linksOutside: outside(links),
        itemsOutside: outside(items),
        copyBoxes: copies.map((l) => l.getClientRects().length),
        firstBoxes: first ? first.getClientRects().length : 0,
        running: (track?.getAnimations() ?? []).filter((a) => a.playState === 'running').length,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });

  if (!hasMarquee) {
    notes.push('marquee: skipped (no .marquee on /)');
  } else {
    for (const viewport of MARQUEE_VIEWPORTS) {
      for (const reducedMotion of ['reduce', 'no-preference']) {
        // Default motion is only guarded at desktop width, where the loop is what visitors see.
        if (reducedMotion === 'no-preference' && viewport.width !== 1440) continue;
        const where0 = `/ @ ${viewport.width}x${viewport.height} (${reducedMotion === 'reduce' ? 'reduced motion' : 'default motion'})`;
        const { context, page, where } = await open('marquee', { viewport, reducedMotion });
        where.current = where0;
        await step('marquee', where0, async () => {
          await load(page, '/');
          await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: T.settle });
          const m = await measure(page);
          if (m.lists !== 2) fail('marquee', where0, `expected 2 .marquee-list elements, found ${m.lists}`);
          if (reducedMotion === 'reduce') {
            if (m.itemsOutside) fail('marquee', where0, `${m.itemsOutside} of ${m.items} word(s) in the first copy are empty or outside the .marquee box`);
            if (m.linksOutside) fail('marquee', where0, `${m.linksOutside} of ${m.links} link(s) in the first copy are empty or outside the .marquee box`);
            if (!m.firstBoxes) fail('marquee', where0, 'the first copy has no layout box');
            if (m.copyBoxes.some((n) => n > 0)) fail('marquee', where0, 'the aria-hidden copy still has a layout box (display: none expected)');
            if (m.scrollWidth > m.innerWidth) fail('marquee', where0, `page scrolls sideways: scrollWidth ${m.scrollWidth} > innerWidth ${m.innerWidth}`);
            if (m.running) fail('marquee', where0, `${m.running} .marquee-track animation(s) running under reduced motion`);
            // #349: a compact list, not a screen-tall wall with a "/" dangling at the end of every line.
            if (m.sepsShown) fail('marquee', where0, `${m.sepsShown} "/" separator(s) still rendered in the static list`);
            if (viewport.width === 390) {
              if (m.gutter.some((g) => Math.abs(g - 16) > 0.5)) fail('marquee', where0, `side gutter is ${m.gutter.join('/')} px, expected 16`);
              if (m.listHeight > 0.4 * m.innerHeight) fail('marquee', where0, `static list is ${Math.round(m.listHeight)} px tall, over 40% of the ${m.innerHeight} px viewport`);
            }
            if (!failures.some((f) => f.where === where0)) notes.push(`marquee: ${where0}: ${m.items} words, ${m.links} links, all inside the band, list ${Math.round(m.listHeight)} px tall`);
          } else {
            if (!m.running) fail('marquee', where0, 'no .marquee-track animation running under default motion');
            if (!m.firstBoxes || m.copyBoxes.some((n) => !n)) fail('marquee', where0, 'a .marquee-list has no layout box under default motion');
          }
        });
        if (failures.some((f) => f.where === where0)) await screenshot(page, `marquee-${viewport.width}-${reducedMotion}`);
        await context.close();
      }
    }
  }
}

await browser.close();
await server.close();

const seconds = ((Date.now() - started) / 1000).toFixed(1);
for (const n of notes) console.log(`smoke: ${n}`);
const ran = CHECKS.filter(run).join(', ');
if (failures.length) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ checks: ran, sitemapUrls: paths.length, redirectPages: redirects.length, notes, failures }, null, 2) + '\n');
  console.error(`smoke: ${failures.length} failure(s) in ${seconds} s (checks: ${ran}). Report: ${join(OUT.startsWith(process.cwd()) ? relative(process.cwd(), OUT) : OUT, 'report.json')}`);
  process.exit(1);
}
console.log(`smoke: all clean in ${seconds} s (checks: ${ran})`);
