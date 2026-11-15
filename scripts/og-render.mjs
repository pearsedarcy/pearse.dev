/**
 * The retry and exit logic of scripts/og-pages.mjs, kept free of any browser so
 * tests/og-render.test.mjs can drive it with a fake renderer.
 *
 * renderAll runs a parallel first pass, then re-renders each failed card once,
 * one at a time. outcome turns the result into an exit code and warnings.
 */

/**
 * @param {object} opts
 * @param {{slug: string}[]} opts.cards
 * @param {(card: {slug: string}, info: {pass: 'first' | 'retry', slot: number}) => Promise<void>} opts.renderOne
 *   Renders one card; rejects on failure.
 * @param {number} [opts.concurrency] Cards in flight during the first pass.
 * @param {() => Promise<void>} [opts.relaunch] Called before each retry. It should do nothing while
 *   the browser is healthy and launch a new one when it crashed or disconnected. Optional.
 * @param {(slug: string, err: Error, pass: 'first' | 'retry') => void} [opts.onFail]
 * @returns {Promise<{rendered: string[], failed: string[], retried: string[]}>} slugs, sorted
 */
export async function renderAll({ cards, renderOne, concurrency = 4, relaunch, onFail }) {
  const rendered = [];
  const stillFailing = [];
  const queue = [...cards];
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async (_, slot) => {
      for (let card = queue.shift(); card; card = queue.shift()) {
        try {
          await renderOne(card, { pass: 'first', slot });
          rendered.push(card.slug);
        } catch (err) {
          stillFailing.push({ card, err });
          onFail?.(card.slug, err, 'first');
        }
      }
    }),
  );

  const retried = [];
  const failed = [];
  // One retry per failed card, strictly serial: a parallel retry would repeat the original load.
  for (const { card } of stillFailing) {
    try {
      await relaunch?.();
      await renderOne(card, { pass: 'retry', slot: 0 });
      rendered.push(card.slug);
      retried.push(card.slug);
    } catch (err) {
      failed.push(card.slug);
      onFail?.(card.slug, err, 'retry');
    }
  }
  return { rendered: rendered.sort(), failed: failed.sort(), retried: retried.sort() };
}

/**
 * The exit decision, pure. CI fails when Chrome is missing or any card still fails; locally it
 * warns (naming slugs only) and exits 0, and those pages keep the default image.
 * @returns {{exitCode: number, warnings: string[]}}
 */
export function outcome({ chrome, failed, ci }) {
  const warnings = [];
  if (!chrome) {
    warnings.push('og:pages: no Chrome found (CHROME_PATH, google-chrome, chromium, chromium-browser); every page keeps the default image.');
  } else if (failed.length) {
    warnings.push(`og:pages: ${failed.length} card(s) failed after one retry and keep the default image: ${failed.join(', ')}`);
  }
  if (ci && (!chrome || failed.length)) {
    warnings.push('og:pages: CI must render every card.');
    return { exitCode: 1, warnings };
  }
  return { exitCode: 0, warnings };
}
