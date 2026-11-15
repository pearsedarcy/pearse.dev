#!/usr/bin/env node
/**
 * Render one Open Graph card per published article and visible case study to
 * public/og/<slug>.png (1200x630) in one headless Chrome driven by playwright-core, in the
 * default card's type and colours. Runs as `prebuild`, so `npm run build` always regenerates;
 * public/og/ is generated and gitignored. `npm run og:pages` runs it alone.
 *
 * Which pages get a card follows src/lib/visibility.ts, the same rules the
 * pages use: drafts, future-dated articles and `pending` client case studies
 * get none. The directory is emptied first, so nothing stale survives.
 *
 * One browser, four pages in flight at once, a 30 s limit per card. A card that fails is re-rendered
 * once, serially, in a fresh browser if the first one crashed (scripts/og-render.mjs). Under CI the
 * step fails when Chrome is missing or any card still fails; locally it warns, names the slugs and
 * exits 0, and those pages keep the default image (src/lib/og.ts checks for the file). If
 * playwright-core cannot be imported it fails loudly everywhere.
 * Writes .astro/og-pages.json ({ chrome, rendered, failed, retried }) for tests/og.test.mjs.
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CATEGORY_LABEL, formatDate, readingTime } from '../src/lib/site.ts';
import { isCaseStudy, isPublishedPost } from '../src/lib/visibility.ts';
import { caseNumber, compareWork } from '../src/lib/work-order.ts';
import { entries } from './content-entries.mjs';
import { renderAll, outcome } from './og-render.mjs';
import { FONT_FACES, findChrome, icosahedronLines, root } from './og-shared.mjs';

const OUT = resolve(root, 'public/og');
const WORK = resolve(root, '.astro/og-pages');
const STATUS = resolve(root, '.astro/og-pages.json');
const CONCURRENCY = 4;
const CARD_TIMEOUT = 30_000;

function cards(now = new Date()) {
  const out = [];
  for (const { file, data, body } of entries('src/content/posts')) {
    const pubDate = new Date(data.pubDate);
    if (Number.isNaN(pubDate.getTime())) throw new Error(`posts/${file}: bad pubDate`);
    if (!isPublishedPost({ draft: data.draft === true, pubDate }, now)) continue;
    out.push({
      slug: data.slug ?? basename(file, extname(file)),
      kind: 'article',
      title: String(data.title),
      tag: 'Writing',
      kicker: `${formatDate(pubDate)} / ${readingTime(body)} min read`,
    });
  }
  // Case studies in /work/ order, so a card's number matches the one on its page. Smaller builds
  // have no page, so they get no card and take no number (ADR 0007).
  const visible = entries('src/content/projects').filter(({ data }) => isCaseStudy(data));
  for (const { file, data } of visible) if (!data.slug) throw new Error(`projects/${file}: no slug`);
  visible.sort((a, b) => compareWork(a.data, b.data));
  for (const [i, { data }] of visible.entries()) {
    out.push({
      slug: data.slug,
      kind: 'case',
      title: String(data.title),
      tag: caseNumber(i),
      kicker: `${CATEGORY_LABEL[data.category]} / ${data.period}`,
    });
  }
  const seen = new Set();
  for (const { slug } of out) {
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`OG slug not URL-safe: ${slug}`);
    if (seen.has(slug)) throw new Error(`An article and a case study share the slug "${slug}"; /og/${slug}.png would collide.`);
    seen.add(slug);
  }
  return out;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Title starts large and steps down until it fits three lines and the box with no word wider than
// the line, then clamps (and may break words) as a backstop.
function cardHtml(card) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
${FONT_FACES}
html,body{margin:0;width:1200px;height:630px;background:#0a0a0a;color:#f2f2ee;overflow:hidden}
.card{position:relative;width:1200px;height:630px;padding:64px 72px 78px;box-sizing:border-box;display:flex;flex-direction:column}
.kicker{font-family:Mono;font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#8f8f89}
.kicker b{color:#c6ff3d;font-weight:600;margin-right:18px}
.ico{width:58px;height:58px;margin:-14px 0 -14px 0}
.area{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;padding:28px 0 36px}
.title{margin:0;width:1040px;font-family:Archivo;text-wrap:balance}
.case .title{font-weight:820;font-stretch:125%;letter-spacing:-.035em;text-transform:uppercase;line-height:.88}
.article .title{font-weight:760;font-stretch:112%;letter-spacing:-.025em;line-height:1}
.title.clamp{overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.foot{display:flex;justify-content:space-between;align-items:center;border-top:2px solid #2a2a27;padding-top:22px}
.brand{display:flex;align-items:center;gap:18px}
.who{font-family:Mono;font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#8f8f89}
.url{font-family:Mono;font-size:26px;color:#f2f2ee}
.url b{color:#c6ff3d;font-weight:600}
.bar{position:absolute;left:0;right:0;bottom:0;height:14px;background:#c6ff3d}
</style></head><body>
<div class="card ${card.kind}">
  <div class="kicker"><b>${esc(card.tag)}</b>${esc(card.kicker)}</div>
  <div class="area"><h1 class="title">${esc(card.title)}</h1></div>
  <div class="foot"><div class="who">Pearse D’Arcy</div><div class="brand"><svg class="ico" viewBox="40 40 320 320" fill="none">${icosahedronLines(' vector-effect="non-scaling-stroke"')}</svg><div class="url">pearse<b>.</b>dev</div></div></div>
  <div class="bar"></div>
</div>
<script>
document.fonts.ready.then(() => {
  const t = document.querySelector('.title');
  const area = t.parentElement;
  const room = area.clientHeight - 64;
  const lh = parseFloat(getComputedStyle(t).lineHeight) / parseFloat(getComputedStyle(t).fontSize);
  for (let size = ${card.kind === 'case' ? 150 : 112}; size >= 48; size -= 2) {
    t.style.fontSize = size + 'px';
    const h = t.getBoundingClientRect().height;
    if (h <= Math.min(3 * size * lh, room) + 1 && t.scrollWidth <= t.clientWidth) break;
  }
  t.classList.add('clamp');
});
</script>
</body></html>`;
}

let browser;

async function launch(chromium, chrome) {
  // Playwright adds --no-sandbox unless chromiumSandbox is true. The card HTML is trusted local
  // HTML, so only CI drops the sandbox (matches og-image.mjs and cv-pdf.mjs).
  return chromium.launch({
    executablePath: chrome,
    chromiumSandbox: !process.env.CI,
    args: ['--disable-gpu', '--hide-scrollbars'],
  });
}

// Load the card from a file:// URL (not setContent: the @font-face rules point at file:// URLs in
// node_modules, which an about:blank page cannot load), wait for the fitting script's last step
// (the `clamp` class on .title), then screenshot.
async function render(card) {
  const html = join(WORK, `${card.slug}.html`);
  const out = join(OUT, `${card.slug}.png`);
  writeFileSync(html, cardHtml(card));
  const deadline = Date.now() + CARD_TIMEOUT;
  const left = () => Math.max(1, deadline - Date.now());
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(html).href, { timeout: left() });
    await page.waitForFunction(() => document.querySelector('.title')?.classList.contains('clamp'), undefined, { timeout: left() });
    await page.screenshot({ path: out, type: 'png', timeout: left() });
  } catch (err) {
    rmSync(out, { force: true });
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
  if (!existsSync(out) || statSync(out).size === 0) throw new Error('Chrome wrote no screenshot');
}

const started = Date.now();
rmSync(OUT, { recursive: true, force: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

const todo = cards();
const chrome = findChrome();
let result = { rendered: [], failed: [], retried: [] };

if (chrome) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (err) {
    console.error(`og:pages: cannot import playwright-core (${err.message.split('\n')[0]}); run npm ci. Refusing to fall back to the default image.`);
    process.exit(1);
  }
  try {
    browser = await launch(chromium, chrome);
    result = await renderAll({
      cards: todo,
      concurrency: CONCURRENCY,
      renderOne: render,
      // A crashed or disconnected browser is replaced before the retry; a healthy one is kept.
      relaunch: async () => {
        if (browser.isConnected()) return;
        await browser.close().catch(() => {});
        browser = await launch(chromium, chrome);
      },
      onFail: (slug, err, pass) =>
        console.warn(`og:pages: ${slug} failed${pass === 'first' ? ', retrying once' : ''}: ${err.message.split('\n')[0]}`),
    });
  } finally {
    await browser?.close().catch(() => {});
  }
}
for (const slug of result.failed) rmSync(join(OUT, `${slug}.png`), { force: true });
rmSync(WORK, { recursive: true, force: true });
writeFileSync(STATUS, JSON.stringify({ chrome, ...result }, null, 2) + '\n');
console.log(`og:pages: ${result.rendered.length}/${todo.length} cards in public/og/ (${((Date.now() - started) / 1000).toFixed(1)} s)${result.retried.length ? `, retried: ${result.retried.join(', ')}` : ''}`);
const { exitCode, warnings } = outcome({ chrome, failed: result.failed, ci: Boolean(process.env.CI) });
for (const w of warnings) (exitCode ? console.error : console.warn)(w);
process.exit(exitCode);
