// The stack-layer buttons are toggles (#142): the pure toggle rule, the built markup, the styles
// that ship and the source guards for the touch fix.
// Relies on `npm test`'s pretest build; run `npm run build` first when running this file alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NONE_PRESSED, togglePressed } from '../src/lib/stack-toggle.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const html = () => readFileSync('dist/index.html', 'utf8');

/** Every CSS source that ships: the inline <style> blocks, plus any emitted stylesheet. */
function shippedCss() {
  const inline = [...html().matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const emitted = existsSync('dist/_astro')
    ? readdirSync('dist/_astro')
        .filter((f) => f.endsWith('.css'))
        .map((f) => readFileSync(`dist/_astro/${f}`, 'utf8'))
    : [];
  return [...inline, ...emitted].join('\n');
}

/** The `selector{body}` rules of a stylesheet, flattened (an @media wrapper is looked through). */
function rules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

test('togglePressed: press from none, release the pressed one, switch to another', () => {
  assert.equal(NONE_PRESSED, -1);
  for (let i = 0; i < 5; i++) assert.equal(togglePressed(-1, i), i, `none -> ${i}`);
  for (let i = 0; i < 5; i++) assert.equal(togglePressed(i, i), -1, `${i} released`);
  assert.equal(togglePressed(0, 3), 3);
  assert.equal(togglePressed(4, 1), 1);
});

test('built home page: five unpressed stack-layer buttons and five poster slabs', () => {
  const buttons = html().match(/<button\b[^>]*\bclass="[^"]*\bstack-layer\b[^>]*>/g) ?? [];
  assert.equal(buttons.length, 5, 'five stack-layer buttons');
  const layers = buttons.map((tag) => {
    assert.match(tag, /\baria-pressed="false"/, tag);
    return Number(/\bdata-layer="([0-4])"/.exec(tag)?.[1]);
  });
  assert.deepEqual([...layers].sort(), [0, 1, 2, 3, 4]);
  const slabs = html().match(/<g\b[^>]*\bdata-slab="[0-4]"[^>]*>/g) ?? [];
  assert.equal(slabs.length, 5, 'five slab groups');
  assert.deepEqual(
    slabs.map((tag) => Number(/\bdata-slab="([0-4])"/.exec(tag)[1])).sort(),
    [0, 1, 2, 3, 4],
  );
});

test('shipped styles: pressed slab lime, others dimmed, hover only on hover devices, pointer cursor', () => {
  const css = shippedCss();
  const all = rules(css);
  const slabRules = all.filter((r) => r.selector.includes('data-active') && r.selector.includes('data-slab'));
  assert.ok(slabRules.some((r) => /stroke-opacity:/.test(r.body) && /(^|[;\s])stroke:/.test(r.body)), 'a data-active/data-slab rule sets stroke and stroke-opacity');
  assert.ok(slabRules.some((r) => r.selector.includes(':not(')), 'the dim rule for the other slabs exists');
  assert.match(css, /@media\s*\(hover:\s*hover\)/);
  assert.ok(all.some((r) => r.selector.includes('stack-layer') && /cursor:\s*pointer/.test(r.body)), 'stack-layer has cursor: pointer');
  assert.ok(all.some((r) => r.selector.includes('aria-pressed')), 'a rule styles aria-pressed');
  // The hover rules live inside the media query and not outside it.
  const outside = css.replace(/@media\s*\(hover:\s*hover\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  assert.doesNotMatch(outside, /\.stack-layer\[?[^{]*:hover/, 'no stack-layer :hover rule outside @media (hover: hover)');
});

test('stack.ts: the controller and the touch-sticky-preview guards', () => {
  const src = readFileSync('src/scripts/stack.ts', 'utf8');
  assert.ok(src.includes('setPressed'));
  assert.ok(src.includes(':focus-visible'), 'focus preview only for :focus-visible');
  assert.ok(src.includes('pointerType'), 'pointer preview checks the pointer type');
});

test('StackObject.astro: poster path never imports the scene; click state mirrors to .stack', () => {
  const src = readFileSync('src/components/StackObject.astro', 'utf8');
  const script = src.slice(src.indexOf('<script>'));
  assert.match(script, /closest<HTMLElement>\('\.stack'\)/);
  assert.match(script, /togglePressed\(/);
  assert.match(script, /import type \{[^}]*StackController[^}]*\} from '\.\.\/scripts\/stack'/);
  assert.equal((script.match(/import\('\.\.\/scripts\/stack'\)/g) ?? []).length, 1, 'one dynamic import');
  assert.equal(/aria-selected|role="radio"/.test(src), false);
});
