// Unit tests for scripts/og-render.mjs: the first pass, the serial retry and the exit decision of
// the Open Graph card step (#273). A fake renderOne stands in for the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcome, renderAll } from '../scripts/og-render.mjs';

const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map((slug) => ({ slug }));
const tick = () => new Promise((r) => setTimeout(r, 5));

test('every card succeeds the first time: nothing failed, nothing retried', async () => {
  const calls = [];
  const res = await renderAll({
    cards,
    renderOne: async (c) => {
      calls.push(c.slug);
      await tick();
    },
  });
  assert.deepEqual(res.failed, []);
  assert.deepEqual(res.retried, []);
  assert.deepEqual(res.rendered, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(calls.length, cards.length, 'each card rendered exactly once');
});

test('the first pass keeps at most `concurrency` cards in flight', async () => {
  let inFlight = 0;
  let peak = 0;
  await renderAll({
    cards,
    concurrency: 3,
    renderOne: async () => {
      peak = Math.max(peak, ++inFlight);
      await tick();
      inFlight--;
    },
  });
  assert.equal(peak, 3);
});

test('a card that fails once and then succeeds is rendered and retried, not failed', async () => {
  const seen = new Set();
  const res = await renderAll({
    cards,
    renderOne: async (c) => {
      if (c.slug === 'c' && !seen.has('c')) {
        seen.add('c');
        throw new Error('Chrome wrote no screenshot');
      }
    },
  });
  assert.deepEqual(res.retried, ['c']);
  assert.deepEqual(res.failed, []);
  assert.ok(res.rendered.includes('c'));
  assert.equal(res.rendered.length, cards.length);
});

test('a card that fails both times is failed, and the retry pass runs one card at a time, once each', async () => {
  const attempts = {};
  let inRetry = 0;
  let peakRetry = 0;
  const res = await renderAll({
    cards,
    renderOne: async (c, { pass }) => {
      attempts[c.slug] = (attempts[c.slug] ?? 0) + 1;
      if (pass === 'retry') {
        peakRetry = Math.max(peakRetry, ++inRetry);
        await tick();
        inRetry--;
      }
      if (['b', 'd', 'e'].includes(c.slug)) throw new Error('boom');
    },
  });
  assert.deepEqual(res.failed, ['b', 'd', 'e']);
  assert.deepEqual(res.retried, []);
  assert.deepEqual(res.rendered, ['a', 'c', 'f']);
  assert.equal(peakRetry, 1, 'no overlapping calls in the retry pass');
  assert.deepEqual(attempts, { a: 1, b: 2, c: 1, d: 2, e: 2, f: 1 }, 'one retry, never more');
});

test('relaunch runs before each retry and not at all when nothing failed', async () => {
  let relaunches = 0;
  await renderAll({ cards, renderOne: async () => {}, relaunch: async () => void relaunches++ });
  assert.equal(relaunches, 0);

  const failFirst = new Set(['a', 'b']);
  await renderAll({
    cards,
    renderOne: async (c, { pass }) => {
      if (pass === 'first' && failFirst.has(c.slug)) throw new Error('crash');
    },
    relaunch: async () => void relaunches++,
  });
  assert.equal(relaunches, 2);
});

test('a relaunch that throws fails that card without aborting the rest', async () => {
  const res = await renderAll({
    cards: cards.slice(0, 3),
    renderOne: async (c, { pass }) => {
      if (pass === 'first' && c.slug !== 'a') throw new Error('crash');
    },
    relaunch: async () => {
      throw new Error('no browser');
    },
  });
  assert.deepEqual(res.failed, ['b', 'c']);
  assert.deepEqual(res.rendered, ['a']);
});

test('onFail hears each failure with its pass', async () => {
  const heard = [];
  await renderAll({
    cards: cards.slice(0, 2),
    renderOne: async (c) => {
      if (c.slug === 'a') throw new Error('x');
    },
    onFail: (slug, err, pass) => heard.push(`${slug}:${pass}:${err.message}`),
  });
  assert.deepEqual(heard, ['a:first:x', 'a:retry:x']);
});

test('outcome: CI fails on a failed card or on no Chrome', () => {
  assert.equal(outcome({ chrome: '/x', failed: ['a'], ci: true }).exitCode, 1);
  assert.equal(outcome({ chrome: null, failed: [], ci: true }).exitCode, 1);
  assert.equal(outcome({ chrome: '/x', failed: [], ci: true }).exitCode, 0);
});

test('outcome: locally a failed card warns with its slug and exits 0', () => {
  const { exitCode, warnings } = outcome({ chrome: '/x', failed: ['a'], ci: false });
  assert.equal(exitCode, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\ba\b/);
});

test('outcome: no Chrome locally is one warning and exit 0', () => {
  const { exitCode, warnings } = outcome({ chrome: null, failed: [], ci: false });
  assert.equal(exitCode, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no Chrome/);
});

test('og-pages.mjs drives one browser: no per-card Chrome process, no setContent', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../scripts/og-pages.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /execFile|promisify|screenshotArgs/);
  assert.doesNotMatch(src, /\.setContent\(/);
  assert.match(src, /pathToFileURL\(html\)\.href/);
});
