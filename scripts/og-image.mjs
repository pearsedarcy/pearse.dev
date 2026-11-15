#!/usr/bin/env node
/**
 * Render public/og-default.png (1200x630) with headless Chrome from an HTML
 * card that uses the same self-hosted fonts as the site. Run once and commit
 * the PNG: `npm run og`. Needs Chrome: $CHROME_PATH, google-chrome,
 * chromium or chromium-browser.
 *
 * Chrome's screenshot is then quantised to a palette with sharp (#278): crawlers and chat
 * unfurlers fetch this image for every page without its own card, so it is held to 50 KB
 * (tests/og.test.mjs). The pass lives here so a later `npm run og` reproduces the committed file.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { FONT_FACES, ROLE_KICKER, findChrome, icosahedronLines, root, screenshotArgs } from './og-shared.mjs';

// Palette size. sharp turns `colours` into a PNG bit depth (2, 4 or 8 bits), so any count from 17
// to 256 is the same 8-bit, 256-entry palette; 16 (4 bits) bands the antialiased Archivo and the
// lime edges on #0a0a0a by eye. 256 entries keep them clean at about 37 KB.
const COLOURS = 256;

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
${FONT_FACES}
html,body{margin:0;width:1200px;height:630px;background:#0a0a0a;color:#f2f2ee;overflow:hidden}
.card{position:relative;width:1200px;height:630px;padding:64px 72px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between}
.kicker{font-family:Mono;font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#8f8f89}
.kicker b{color:#c6ff3d;font-weight:600;margin-right:18px}
.name{font-family:Archivo;font-weight:820;font-stretch:125%;font-size:188px;line-height:.84;letter-spacing:-.035em;text-transform:uppercase;margin:0}
.lede{font-family:Inter;font-size:30px;line-height:1.3;max-width:620px;color:#f2f2ee}
.foot{display:flex;justify-content:space-between;align-items:flex-end}
.url{font-family:Mono;font-size:26px;color:#f2f2ee}
.url b{color:#c6ff3d;font-weight:600}
.ico{position:absolute;right:48px;top:40px;width:420px;height:420px}
.bar{position:absolute;left:0;right:0;bottom:0;height:14px;background:#c6ff3d}
</style></head><body>
<div class="card">
  <div class="kicker"><b>01</b>__KICKER__</div>
  <svg class="ico" viewBox="0 0 400 400" fill="none">__LINES__</svg>
  <div>
    <h1 class="name">Pearse<br>D’Arcy</h1>
  </div>
  <div class="foot">
    <div class="lede">Django platforms for live events, self-hosted AI with guardrails, and agent workflows that ship.</div>
    <div class="url">pearse<b>.</b>dev</div>
  </div>
  <div class="bar"></div>
</div>
</body></html>`;

const tmpDir = resolve(root, '.astro');
mkdirSync(tmpDir, { recursive: true });
const tmp = resolve(tmpDir, 'og.html');
writeFileSync(tmp, html.replace('__KICKER__', ROLE_KICKER).replace('__LINES__', icosahedronLines()));

const chrome = findChrome();
if (!chrome) {
  console.error('No Chrome/Chromium found; cannot render the OG image.');
  process.exit(1);
}
const out = resolve(root, 'public/og-default.png');
const shot = resolve(tmpDir, 'og-screenshot.png');
execFileSync(
  chrome,
  [...screenshotArgs(shot), pathToFileURL(tmp).href],
  { stdio: 'inherit' },
);
const { size } = await sharp(shot)
  .png({ palette: true, colours: COLOURS, effort: 10, compressionLevel: 9 })
  .toFile(out);
rmSync(shot, { force: true });
console.log(`Wrote ${out} (${size} B, ${COLOURS} colours)`);
