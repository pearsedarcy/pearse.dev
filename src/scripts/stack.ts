/**
 * About-section object: five thin slabs — model, admin, UI, workers, deploy —
 * the layers every platform on this site shares. Edges only, so it costs
 * almost nothing. A layer name in the list lights its slab two ways (#142): hover
 * or keyboard focus previews it, and pressing the button (a toggle, see
 * StackObject.astro) keeps it lit. The lit layer is the preview when there is one,
 * otherwise the pressed layer.
 */
import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { devicePixelRatioCapped, visibleLoop } from './env';

export interface StackOptions {
  reduced: boolean;
  layers: number;
  /**
   * Elements whose preview lights slab i (index matches). The preview is mouse and pen
   * hover (touch pointers are ignored, so a tap does not stick) and keyboard focus
   * (only `:focus-visible`, so a tap or click does not leave one). Pressing is the
   * component's job: it calls `setPressed`.
   */
  triggers?: HTMLElement[];
  /** The pressed layer when the scene mounts, -1 for none. */
  pressed?: number;
}

export interface StackController {
  /** Light layer `index` (-1 for none) when no preview is active. Snaps and draws one frame under reduced motion. */
  setPressed(index: number): void;
  dispose(): void;
}

export function mountStack(canvas: HTMLCanvasElement, opts: StackOptions): StackController {
  const host = canvas.parentElement ?? canvas;
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(devicePixelRatioCapped());
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, 1.4, 6.4);
  camera.lookAt(0, 0.1, 0);

  const paper = new Color('#f2f2ee');
  const lime = new Color('#c6ff3d');
  const steel = new Color('#8f8f89');

  const group = new Group();
  group.rotation.y = 0.6;
  scene.add(group);

  const gap = 0.42;
  const geo = new EdgesGeometry(new BoxGeometry(2.1, 0.14, 1.5));
  const slabs: { line: LineSegments; mat: LineBasicMaterial; baseY: number; lit: number }[] = [];
  for (let i = 0; i < opts.layers; i++) {
    const mat = new LineBasicMaterial({ color: i === opts.layers - 1 ? lime : paper, transparent: true, opacity: 0.9 });
    const line = new LineSegments(geo, mat);
    const baseY = (i - (opts.layers - 1) / 2) * gap;
    line.position.y = baseY;
    group.add(line);
    slabs.push({ line, mat, baseY, lit: 0 });
  }

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let preview = -1;
  let pressed = opts.pressed ?? -1;
  /** The lit layer: the preview when there is one, otherwise the pressed layer. */
  const litIndex = () => (preview >= 0 ? preview : pressed);
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    target.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onLeave = () => {
    target.x = 0;
    target.y = 0;
  };
  const cleanups: (() => void)[] = [];
  opts.triggers?.forEach((el, i) => {
    const setPreview = (index: number) => {
      preview = index;
      if (opts.reduced) snap();
    };
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') setPreview(i);
    };
    const focus = () => {
      if (el.matches(':focus-visible')) setPreview(i);
    };
    const leave = () => setPreview(-1);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focus', focus);
    el.addEventListener('blur', leave);
    cleanups.push(() => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focus', focus);
      el.removeEventListener('blur', leave);
    });
  });

  let t = 0;
  /** Move every slab `ease` of the way to its target (1 snaps) and render. */
  const paint = (ease: { lit: number; pos: number }) => {
    const active = litIndex();
    slabs.forEach((s, i) => {
      const want = active === i ? 1 : 0;
      s.lit += (want - s.lit) * ease.lit;
      // Slabs above the active one lift, slabs below sink, so the lit layer stands alone.
      const dir = active < 0 ? 0 : i > active ? 1 : i < active ? -1 : 0;
      const y = s.baseY + dir * 0.18 + Math.sin(t * 0.9 + i * 0.7) * 0.015;
      s.line.position.y += (y - s.line.position.y) * ease.pos;
      const base = i === opts.layers - 1 ? lime : paper;
      s.mat.color.copy(base).lerp(lime, s.lit);
      s.mat.opacity = active >= 0 && active !== i ? 0.45 : 0.9;
      if (active >= 0 && active !== i) s.mat.color.lerp(steel, 0.4);
    });
    renderer.render(scene, camera);
  };
  const orient = () => {
    group.rotation.y = 0.6 + t * 0.25 + current.x * 0.35;
    group.rotation.x = current.y * -0.18;
    group.rotation.z = Math.sin(t * 0.4) * 0.02;
  };
  const draw = (dt: number) => {
    t += dt;
    current.x += (target.x - current.x) * 0.08;
    current.y += (target.y - current.y) * 0.08;
    orient();
    paint({ lit: 0.15, pos: 0.12 });
  };
  /** Reduced motion: colours and positions jump to their targets and one frame is drawn. No loop. */
  function snap() {
    paint({ lit: 1, pos: 1 });
  }

  canvas.classList.add('is-ready');

  if (opts.reduced) {
    t = 1.2;
    orient();
    snap();
    return {
      setPressed(index) {
        pressed = index;
        snap();
      },
      dispose() {
        cleanups.forEach((fn) => fn());
        ro.disconnect();
        geo.dispose();
        slabs.forEach((s) => s.mat.dispose());
        renderer.dispose();
      },
    };
  }

  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerleave', onLeave);
  const stop = visibleLoop(canvas, draw);

  return {
    setPressed(index) {
      pressed = index;
    },
    dispose() {
      stop();
      ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      cleanups.forEach((fn) => fn());
      geo.dispose();
      slabs.forEach((s) => s.mat.dispose());
      renderer.dispose();
    },
  };
}
