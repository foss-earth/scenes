import type { ViewRecord } from "./format.js";
import type { ScenePreviewFace } from "./ports.js";

/** Opaque cover in normalized image coordinates; radius is relative to image width. */
export interface PreviewCover { x: number; y: number; width: number; height: number; radius: number }
export type PreviewOcclusion = readonly PreviewCover[];
export function coversContain(next: PreviewOcclusion, previous: PreviewOcclusion): boolean {
  return previous.every(old => next.some(cover =>
    cover.x === old.x && cover.y === old.y && cover.width === old.width && cover.height === old.height && cover.radius === old.radius ||
    cover.radius === 0 && cover.x <= old.x && cover.y <= old.y && cover.x + cover.width >= old.x + old.width && cover.y + cover.height >= old.y + old.height));
}
export interface PreviewSurface {
  paint(look: ViewRecord, covers?: PreviewOcclusion): boolean;
  destroy(): void;
}
/** A backend owns shared sheet textures and one projection surface, never a device per card. */
export interface PreviewBackend {
  create(canvas: HTMLCanvasElement, face: ScenePreviewFace, ready: () => void, failed: () => void): PreviewSurface;
  destroy(): void;
}
export type PreviewBackendLoader = () => Promise<PreviewBackend>;

/** Dynamic imports are inside the selected branch, including the CPU fallback. */
export function createPreviewBackends(options: { loadGpu?: PreviewBackendLoader; loadCpu?: PreviewBackendLoader } = {}): PreviewBackend {
  const loadCpu = options.loadCpu ?? (() => import("./miniViewerCpu.js").then(module => module.createCpuPreviewBackend()));
  let pending: Promise<PreviewBackend> | null = null;
  let current: PreviewBackend | null = null;
  let dead = false, cpu = !options.loadGpu;
  let generation = 0;
  const surfaces = new Set<{ reset(): void; destroy(): void }>();
  const load = (): Promise<PreviewBackend> => pending ??= Promise.resolve().then(cpu ? loadCpu : options.loadGpu!).catch(error => {
    if (cpu || dead) throw error;
    cpu = true;
    return loadCpu();
  }).then(value => {
    if (dead) { value.destroy(); throw Error("Preview retired"); }
    current = value;
    return value;
  });
  const fallback = (): void => {
    if (dead || cpu) return;
    cpu = true; generation++;
    for (const surface of surfaces) surface.reset();
    current?.destroy(); current = null; pending = null;
    for (const surface of surfaces) surface.reset();
  };
  return {
    create(canvas, face, ready) {
      let surface: PreviewSurface | null = null;
      let look: ViewRecord | null = null;
      let covers: PreviewOcclusion = [], drawnCovers: PreviewOcclusion = [];
      let shown = "", requested = -1, retired = false;
      const draw = (): boolean => {
        if (dead || retired || !look) return false;
        const key = `${canvas.width}:${canvas.height}:${look.headingDeg}:${look.pitchDeg}:${look.verticalFovDeg}`;
        if (key === shown && coversContain(covers, drawnCovers)) return false;
        if (surface) {
          try { if (surface.paint(look, covers)) { shown = key; drawnCovers = covers.map(cover => ({ ...cover })); ready(); return true; } }
          catch { fallback(); }
          return false;
        }
        if (requested === generation) return false;
        const ticket = requested = generation;
        void load().then(backend => {
          if (dead || retired || ticket !== generation) return;
          surface = backend.create(canvas, face, () => { shown = ""; draw(); }, fallback);
          draw();
        }).catch(() => { fallback(); });
        return false;
      };
      const owner = {
        reset() { surface?.destroy(); surface = null; shown = ""; requested = -1; if (!current) draw(); },
        destroy() { if (retired) return; retired = true; surface?.destroy(); surface = null; surfaces.delete(owner); },
      };
      surfaces.add(owner);
      return { paint(next, occlusion = []) { look = { ...next }; covers = occlusion; return draw(); }, destroy: owner.destroy };
    },
    destroy() {
      if (dead) return;
      dead = true;
      for (const surface of surfaces) surface.destroy();
      current?.destroy(); current = null;
    },
  };
}
