/**
 * One preview-sheet panorama for the open photograph card.
 * The sheet is sampled on a small canvas inside a single iframe, so pointer
 * events stay off the globe and no photograph starts its own WebGL context.
 */
import { attachLookInput, type LookInputOptions } from "@foss-earth/sphere-image/input";
import { bindPhotographPress } from "./photographPress.js";
import { createLookModel, type LookModel, type SphereViewport } from "@foss-earth/sphere-image";
import type { ViewRecord } from "./format.js";
import { createPreviewBackends, type PreviewBackend, type PreviewOcclusion } from "./previewBackend.js";
import type { ScenePreviewFace } from "./ports.js";

export type MiniLook = ViewRecord;

export interface MiniNavigation {
  swipeSensitivity?: number;
  inertiaHalfLifeMs?: number;
  reducedMotion?: boolean;
  dragSensitivity: number;
  zoomPerNotch: number;
  pinchGain: number;
  pitch: { min: number; max: number };
  fov: { min: number; max: number };
}

export const DEFAULT_MINI_NAVIGATION: MiniNavigation = {
  inertiaHalfLifeMs: 100,
  reducedMotion: false,
  dragSensitivity: 0.15,
  zoomPerNotch: 0.1,
  pinchGain: 1,
  pitch: { min: -85, max: 85 },
  fov: { min: 20, max: 120 },
};

/** Backing-store long side. The iframe scales this up; the sheet faces are 64 px. */
const MAX_EDGE = 280;

export type MiniInput = Pick<LookInputOptions, "createWheelGestureClassifier" | "inputMode" | "safariGestures" | "controlTakesKey">;

export interface MiniViewer {
  readonly id: string;
  readonly frame: HTMLIFrameElement;
  getLook(): MiniLook;
  setLook(look: MiniLook): void;
  fit(): void;
  destroy(): void;
}

function wrapHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Use the full panorama's physical look model, including anchored zoom and glide. */
export function createMiniLook(initial: MiniLook, navigation: () => MiniNavigation, onChange: (look: MiniLook) => void, viewport?: () => SphereViewport | null): LookModel {
  return createLookModel(initial, () => {
    const nav = navigation();
    return {
      dragSensitivity: nav.dragSensitivity, swipeSensitivity: nav.swipeSensitivity ?? nav.dragSensitivity,
      zoomPerNotch: nav.zoomPerNotch, pinchGain: nav.pinchGain,
      inertiaHalfLifeMs: nav.inertiaHalfLifeMs ?? 100, reducedMotion: nav.reducedMotion ?? false,
      pitchRangeDeg: nav.pitch, fovRangeDeg: nav.fov, lookRate: 0, zoomRate: 0,
    };
  }, onChange, viewport);
}

export function clampMiniLook(look: MiniLook, nav: MiniNavigation): MiniLook {
  const pitchMin = Math.min(nav.pitch.min, nav.pitch.max);
  const pitchMax = Math.max(nav.pitch.min, nav.pitch.max);
  const fovMin = Math.min(nav.fov.min, nav.fov.max);
  const fovMax = Math.max(nav.fov.min, nav.fov.max);
  return {
    headingDeg: wrapHeading(look.headingDeg),
    pitchDeg: Math.min(pitchMax, Math.max(pitchMin, look.pitchDeg)),
    verticalFovDeg: Math.min(fovMax, Math.max(fovMin, look.verticalFovDeg)),
  };
}

export interface PreviewStill {
  canvas: HTMLCanvasElement;
  setLook(look: MiniLook): void;
  setOcclusion?(covers: PreviewOcclusion): void;
  destroy(): void;
}

/** A cached 88 px frame; no animation loop, iframe or WebGL context. */
export function createPreviewStill(options: { document: Document; id: string; face: ScenePreviewFace; look: MiniLook; backend?: PreviewBackend }): PreviewStill {
  const canvas = options.document.createElement("canvas");
  canvas.className = "foss-earth-scene-entry__snapshot";
  canvas.width = canvas.height = 88;
  const backend = options.backend ?? createPreviewBackends();
  const painter = backend.create(canvas, options.face, () => paint(), () => {});
  canvas.setAttribute("aria-hidden", "true");
  let look = { ...options.look };
  let covers: PreviewOcclusion = [];
  let dead = false;
  const paint = (): void => { if (!dead) painter.paint(look, covers); };
  paint();
  return {
    canvas,
    setLook(next) {
      if (look.headingDeg === next.headingDeg && look.pitchDeg === next.pitchDeg && look.verticalFovDeg === next.verticalFovDeg) return;
      look = { ...next };
      paint();
    },
    setOcclusion(next) { covers = next; paint(); },
    destroy() { if (dead) return; dead = true; painter.destroy(); if (!options.backend) backend.destroy(); canvas.width = canvas.height = 0; canvas.remove(); },
  };
}

/** An idle interval is never camera time; ongoing glide uses consecutive frame times. */
export function createMiniFrames(options: {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
  step(dt: number): boolean;
  paint(): void;
}): { request(): void; destroy(): void } {
  let pending: number | null = null;
  let last = 0;
  let dead = false;
  const tick = (now: number): void => {
    pending = null;
    if (dead) return;
    const moving = options.step(now - last);
    last = now;
    options.paint();
    if (moving) pending = options.request(tick);
  };
  return {
    request() {
      if (dead || pending !== null) return;
      last = options.now();
      pending = options.request(tick);
    },
    destroy() { dead = true; if (pending !== null) options.cancel(pending); pending = null; },
  };
}

const FRAME_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b1220;overflow:hidden}
canvas{display:block;width:100%;height:100%;touch-action:none}
</style></head><body></body></html>`;

export function createMiniViewer(options: {
  document: Document;
  id: string;
  face: ScenePreviewFace;
  look: MiniLook | null;
  navigation(): MiniNavigation;
  input?: MiniInput;
  backend?: PreviewBackend;
  occlusion?(): PreviewOcclusion;
  onLook(look: MiniLook): void;
  onTap(): void;
  onHold(): void;
}): MiniViewer {
  const frame = options.document.createElement("iframe");
  frame.className = "foss-earth-mini";
  frame.style.visibility = "hidden";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.srcdoc = FRAME_HTML;
  let dead = false;
  let look = clampMiniLook(options.look ?? { headingDeg: 0, pitchDeg: 0, verticalFovDeg: 90 }, options.navigation());
  let started = false;
  let model: LookModel | null = null;
  const backend = options.backend ?? createPreviewBackends();
  let painter: import("./previewBackend.js").PreviewSurface | null = null;
  const cleanups: (() => void)[] = [];

  const paint = (): void => {
    painter?.paint(look, options.occlusion?.());
  };

  const fit = (): void => {
    if (dead || !started) return;
    const doc = frame.contentDocument;
    const canvas = doc?.querySelector("canvas");
    const view = doc?.defaultView;
    if (!doc || !canvas || !view) return;
    const cssW = Math.max(1, doc.body.clientWidth);
    const cssH = Math.max(1, doc.body.clientHeight);
    const dpr = Math.min(view.devicePixelRatio || 1, 2);
    const scale = Math.min(1, MAX_EDGE / Math.max(cssW, cssH) / dpr);
    const width = Math.max(1, Math.round(cssW * dpr * scale));
    const height = Math.max(1, Math.round(cssH * dpr * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    paint();
  };

  frame.addEventListener("load", () => {
    if (dead || started) return;
    const doc = frame.contentDocument;
    const view = doc?.defaultView;
    if (!doc || !view) return;
    started = true;
    const canvas = doc.createElement("canvas");
    painter = backend.create(canvas, options.face, () => { frame.style.visibility = "visible"; }, () => {});
    cleanups.push(() => painter?.destroy());
    doc.body.append(canvas);
    const frames = createMiniFrames({
      now: () => view.performance.now(), request: callback => view.requestAnimationFrame(callback),
      cancel: handle => view.cancelAnimationFrame(handle),
      step: dt => model?.step(dt) ?? false, paint,
    });
    model = createMiniLook(look, options.navigation, next => {
      look = next;
      options.onLook(look);
    }, () => ({ width: doc.body.clientWidth, height: doc.body.clientHeight }));
    cleanups.push(bindPhotographPress(canvas, {
      onTap: options.onTap, onHold: options.onHold, isMoving: () => model!.moving(),
    }));
    const binding = attachLookInput({
      window: view, canvas, model,
      controlTakesKey: () => true,
      createWheelGestureClassifier: () => event => event.ctrlKey ? "pinchZoom" : "wheelZoom",
      ...options.input,
      ownsKeys: () => false,
      localPoint: (x, y) => { const rect = canvas.getBoundingClientRect(); return { x: x - rect.left, y: y - rect.top }; },
      onExit: options.onHold, onUserInput: () => {}, requestFrame: frames.request,
    });
    cleanups.push(() => { binding.detach(); frames.destroy(); });
    const observer = new view.ResizeObserver(() => fit());
    observer.observe(doc.body);
    cleanups.push(() => observer.disconnect());
    fit();
  }, { once: true });

  return {
    id: options.id,
    frame,
    getLook: () => look,
    setLook(next) {
      const clamped = clampMiniLook(next, options.navigation());
      if (look.headingDeg === clamped.headingDeg && look.pitchDeg === clamped.pitchDeg && look.verticalFovDeg === clamped.verticalFovDeg) return;
      look = clamped;
      model?.set(look);
      options.onLook(look);
      fit();
    },
    fit,
    destroy() {
      if (dead) return;
      dead = true;
      options.onLook(look);
      for (const cleanup of cleanups) cleanup();
      if (!options.backend) backend.destroy();
      frame.remove();
    },
  };
}
