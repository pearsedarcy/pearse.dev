---
status: accepted
date: 2026-11-01
---

# The 3D scene is for capable desktop visitors; everyone else keeps the poster

Before #99 (PR #124) the two Three.js scenes on the home page (the hero icosahedron and the five-layer stack) checked only whether WebGL was available before importing their scene module. Every phone therefore downloaded and compiled the three.js chunk (about 131 KB gzipped), and under reduced motion the page did all of that to draw one static frame where a build-time SVG poster was already on screen.

Decision: **the full scene loads only for capable, motion-tolerant desktop visitors.** One pure rule, `sceneMode()` in `src/lib/scene-gate.ts`, returns `'gl'` only when WebGL works and none of these is true: the visitor prefers reduced motion, the browser sends Save-Data, the viewport is narrower than 640 px, or the URL has `?lite`. Otherwise it returns `'poster'`, the component sets `data-mode="poster"` and three.js is never fetched. Both components call the rule inside their existing deferral, before the dynamic import. We rejected the WebGL-only check because it charged phones and reduced-motion visitors the full download for a scene they either cannot run well or asked not to see. The poster is not claimed to match the single frame the scenes used to draw; that is a product choice, not a parity claim.

## Consequences

- The three.js chunk is still emitted for the desktop path. `isLowEnd()` stays separate: it lowers detail on desktop scenes that do load and is not part of the gate.
- `?reduce`, `?nogl` and `?lite` force the degraded paths for testing; the browser smoke run (#119) uses them.
- The same principle was applied to the rest of the motion in this wave, each with its own test: the GSAP chunk loads only on pages with motion targets and never under reduced motion (#135, PR #214, `src/lib/motion-gate.ts`); cross-document view transitions are off under reduced motion (#136, PR #211); and a scene that does load caps its frame rate and pauses when idle (#117, PR #172).
- `tests/scene-gate.test.mjs` holds the full truth table over the five flags, the source order in both components, and a built home page with both posters and no three.js reference.
