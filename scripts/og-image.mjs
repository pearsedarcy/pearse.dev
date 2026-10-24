#!/usr/bin/env node
/**
 * Render public/og-default.png (1200x630) with headless Chrome from an HTML
 * card that uses the same self-hosted fonts as the site. Run once and commit
 * the PNG: `npm run og`. Needs google-chrome, chromium or chromium-browser.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const font = (pkg, file) => pathToFileURL(resolve(root, 'node_modules/@fontsource-variable', pkg, 'files', file)).href;

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
@font-face{font-family:Archivo;src:url("${font('archivo', 'archivo-latin-wdth-normal.woff2')}") format("woff2-variations");font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:Mono;src:url("${font('jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2')}") format("woff2-variations");font-weight:100 800}
@font-face{font-family:Inter;src:url("${font('inter', 'inter-latin-wght-normal.woff2')}") format("woff2-variations");font-weight:100 900}
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
  <div class="kicker"><b>01</b>Software engineer / Innsbruck</div>
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

// Same icosahedron projection as src/components/Hero.astro.
const PHI = (1 + Math.sqrt(5)) / 2;
const verts = [];
for (const a of [-1, 1]) for (const b of [-PHI, PHI]) verts.push([0, a, b], [a, b, 0], [b, 0, a]);
const rot = ([x, y, z], ax, ay) => {
  const y1 = y * Math.cos(ax) - z * Math.sin(ax);
  const z1 = y * Math.sin(ax) + z * Math.cos(ax);
  return [x * Math.cos(ay) + z1 * Math.sin(ay), y1, -x * Math.sin(ay) + z1 * Math.cos(ay)];
};
const P = verts.map((v) => rot(v, 0.35, -0.4));
let lines = '';
for (let i = 0; i < verts.length; i++)
  for (let j = i + 1; j < verts.length; j++) {
    const [a, b] = [verts[i], verts[j]];
    if (Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 2) > 1e-6) continue;
    const [pa, pb] = [P[i], P[j]];
    const o = (0.3 + (0.7 * ((pa[2] + pb[2]) / 2 / PHI + 1)) / 2).toFixed(2);
    lines += `<line x1="${200 + pa[0] * 96}" y1="${200 - pa[1] * 96}" x2="${200 + pb[0] * 96}" y2="${200 - pb[1] * 96}" stroke="#c6ff3d" stroke-width="2" stroke-opacity="${o}"/>`;
  }

const tmpDir = resolve(root, '.astro');
mkdirSync(tmpDir, { recursive: true });
const tmp = resolve(tmpDir, 'og.html');
writeFileSync(tmp, html.replace('__LINES__', lines));

const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find((bin) => {
  try {
    execFileSync('command', ['-v', bin], { shell: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!chrome) {
  console.error('No Chrome/Chromium found; cannot render the OG image.');
  process.exit(1);
}
const out = resolve(root, 'public/og-default.png');
execFileSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    `--screenshot=${out}`,
    '--virtual-time-budget=3000',
    pathToFileURL(tmp).href,
  ],
  { stdio: 'inherit' },
);
console.log(`Wrote ${out}`);
