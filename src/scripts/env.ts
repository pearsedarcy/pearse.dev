/**
 * Environment probes shared by the hero and the stack object.
 *
 * Two query-string overrides exist so the degraded paths can be forced
 * without touching OS settings: `?reduce` (prefers-reduced-motion) and
 * `?nogl` (WebGL unavailable). They are documented in the README.
 */
const params = () => new URLSearchParams(window.location.search);

export function prefersReducedMotion(): boolean {
  if (params().has('reduce')) return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function supportsWebGL(): boolean {
  if (params().has('nogl')) return false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext;
  } catch {
    return false;
  }
}

/** Cheap heuristic for "skip the particle layer". */
export function isLowEnd(): boolean {
  const cores = navigator.hardwareConcurrency ?? 8;
  return cores <= 4 || window.innerWidth < 640;
}

export function devicePixelRatioCapped(): number {
  const cap = window.innerWidth < 768 ? 1 : 1.5;
  return Math.min(window.devicePixelRatio || 1, cap);
}

/** Run after first paint and when the main thread is idle. */
export function onIdle(fn: () => void, timeout = 1500): void {
  const go = () => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => fn(), { timeout });
    else w.setTimeout(fn, 200);
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

/**
 * Drives a render loop that only runs while `el` is on screen and the tab
 * is visible. Returns a function that stops everything.
 */
export function visibleLoop(el: Element, tick: (dt: number) => void): () => void {
  let visible = true;
  let hidden = document.hidden;
  let raf = 0;
  let last = performance.now();

  const frame = (now: number) => {
    raf = 0;
    if (!visible || hidden) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tick(dt);
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (raf || !visible || hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? true;
      start();
    },
    { threshold: 0 },
  );
  io.observe(el);

  const onVis = () => {
    hidden = document.hidden;
    start();
  };
  document.addEventListener('visibilitychange', onVis);
  start();

  return () => {
    io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    if (raf) cancelAnimationFrame(raf);
    visible = false;
  };
}
