/** CPU fallback: this module is requested only when no GPU backend can draw. */
import { mulMat3, type Mat3, type Vec3 } from "@foss-earth/images";
import { CUBE_FACE_NAMES, sourceCubeLookup } from "@foss-earth/sphere-cubemap";
import { sphereViewBasis, sphereRay } from "@foss-earth/sphere-image";
import type { MiniLook } from "./miniViewer.js";
import type { ScenePreviewFace } from "./ports.js";
import type { PreviewBackend, PreviewOcclusion } from "./previewBackend.js";
export interface SheetPixels { width: number; height: number; data: Uint8ClampedArray }
/** The common-frame ray through a point of the view. x and y are 0–1, y down. */
export function previewRay(look: MiniLook, width: number, height: number, x: number, y: number): Vec3 {
  return sphereRay(look, { width, height }, { x: x * width, y: y * height });
}

export function samplePreview(pixels: SheetPixels, originX: number, originY: number, size: number, direction: Vec3, content?: Mat3): readonly [number, number, number, number] | null {
  if (!(size >= 1)) return null;
  const image = content ? mulMat3(content, direction) : direction;
  const hit = sourceCubeLookup(image);
  const index = CUBE_FACE_NAMES.indexOf(hit.face);
  if (index < 0) return null;
  const u = Math.min(1, Math.max(0, hit.u));
  const v = Math.min(1, Math.max(0, hit.v));
  const px = Math.round(originX + index * size + u * (size - 1));
  const py = Math.round(originY + v * (size - 1));
  if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) return null;
  const offset = (py * pixels.width + px) * 4;
  return [pixels.data[offset] ?? 0, pixels.data[offset + 1] ?? 0, pixels.data[offset + 2] ?? 0, 255];
}

// One screen-plane row is shared by all cards at this size/FOV. It contains no
// image data, and a new size or zoom replaces it instead of growing a cache.
let screenColumns: { width: number; height: number; fov: number; values: Float64Array } | null = null;
function projectionColumns(width: number, height: number, fov: number): Float64Array {
  if (screenColumns?.width === width && screenColumns.height === height && screenColumns.fov === fov) return screenColumns.values;
  const values = new Float64Array(width), tan = Math.tan(fov / 2), aspect = width / height;
  for (let x = 0; x < width; x++) values[x] = (2 * ((x + .5) / width) - 1) * tan * aspect;
  screenColumns = { width, height, fov, values };
  return values;
}

/** Shared one-frame rendering for static cards and the live mini. */
export function renderPreviewFrame(pixels: SheetPixels, face: ScenePreviewFace, look: MiniLook, width: number, height: number, target?: Uint8ClampedArray, covers: PreviewOcclusion = []): Uint8ClampedArray {
  const dest = target ?? new Uint8ClampedArray(width * height * 4);
  const basis = sphereViewBasis(look, { width, height });
  // Cube lookup depends only on component ratios. A common positive scale
  // cancels, so normalizing each ray is unnecessary. Rotation is linear:
  // rotate this basis once, then form each ray directly in image coordinates.
  const content = face.content;
  const f = content ? mulMat3(content, basis.forward) : basis.forward;
  const r = content ? mulMat3(content, basis.right) : basis.right;
  const up = content ? mulMat3(content, basis.up) : basis.up;
  const tan = Math.tan(basis.verticalFovRad / 2);
  const horizontal = projectionColumns(width, height, basis.verticalFovRad);
  const origin = face.originX ?? face.x;
  // Scalar sourceCubeLookup: no temporary vectors or face-table scans per texel.
  for (let y = 0; y < height; y++) {
    const spans = covers.length ? covers.map(cover => {
      const top = cover.y * height, bottom = (cover.y + cover.height) * height, cy = y + .5;
      if (cy < top || cy >= bottom) return null;
      const radius = cover.radius * width, dy = Math.max(top + radius - cy, cy - (bottom - radius), 0);
      const inset = dy > 0 ? radius - Math.sqrt(Math.max(0, radius * radius - dy * dy)) : 0;
      return [cover.x * width + inset, (cover.x + cover.width) * width - inset];
    }) : null;
    const sy = (1 - 2 * ((y + .5) / height)) * tan;
    const vx = up[0] * sy, vy = up[1] * sy, vz = up[2] * sy;
    for (let x = 0; x < width; x++) {
      if (spans?.some(span => span && x + .5 >= span[0] && x + .5 < span[1])) continue;
      const sx = horizontal[x];
      const ix = f[0] + (r[0] * sx + vx);
      const iy = f[1] + (r[1] * sx + vy);
      const iz = f[2] + (r[2] * sx + vz);
      const ax = Math.abs(ix), ay = Math.abs(iy), az = Math.abs(iz);
      let index: number, along: number, sc: number, tc: number, gap: number;
      if (ax >= ay && ax >= az) { index = ix >= 0 ? 0 : 1; along = ax; gap = ax - Math.max(ay, az); sc = ix >= 0 ? -iy : iy; tc = iz; }
      else if (ay >= az) { index = iy >= 0 ? 2 : 3; along = ay; gap = ay - Math.max(ax, az); sc = iy >= 0 ? ix : -ix; tc = iz; }
      else { index = iz >= 0 ? 4 : 5; along = az; gap = az - Math.max(ax, ay); sc = ix; tc = iz >= 0 ? -iy : iy; }
      const inverseAlong = 1 / along;
      const u = Math.min(1, Math.max(0, (sc * inverseAlong + 1) / 2));
      const v = Math.min(1, Math.max(0, (1 - tc * inverseAlong) / 2));
      const texelX = origin + index * face.size + u * (face.size - 1);
      const texelY = face.y + v * (face.size - 1);
      const px = Math.round(texelX), py = Math.round(texelY);
      const offset = (y * width + x) * 4;
      // Reassociating floating-point operations can change a texel exactly at
      // a cube seam or rounding boundary. Preserve the reference there only.
      if (gap <= along * 1e-12 || Math.abs(px - texelX) >= .5 - 1e-10 || Math.abs(py - texelY) >= .5 - 1e-10) {
        const sample = samplePreview(pixels, origin, face.y, face.size, previewRay(look, width, height, (x + .5) / width, (y + .5) / height), content);
        dest[offset] = sample?.[0] ?? 11;
        dest[offset + 1] = sample?.[1] ?? 18;
        dest[offset + 2] = sample?.[2] ?? 32;
        dest[offset + 3] = 255;
        continue;
      }
      if (face.size >= 1 && px >= 0 && py >= 0 && px < pixels.width && py < pixels.height) {
        const source = (py * pixels.width + px) * 4;
        dest[offset] = pixels.data[source] ?? 0;
        dest[offset + 1] = pixels.data[source + 1] ?? 0;
        dest[offset + 2] = pixels.data[source + 2] ?? 0;
      } else { dest[offset] = 11; dest[offset + 1] = 18; dest[offset + 2] = 32; }
      dest[offset + 3] = 255;
    }
  }
  return dest;
}

/** Reuse one ImageData per size and never redraw an identical image/pose. */
export function createPreviewPainter(canvas: HTMLCanvasElement, face: ScenePreviewFace): { paint(pixels: SheetPixels, look: MiniLook, covers?: PreviewOcclusion): boolean } {
  let context: CanvasRenderingContext2D | null = null;
  let output: ImageData | null = null;
  let shown: MiniLook | null = null;
  let source: SheetPixels | null = null;
  let coverKey = "";
  return {
    paint(pixels, look, covers = []) {
      context ??= canvas.getContext("2d");
      if (!context) return false;
      const resized = !output || output.width !== canvas.width || output.height !== canvas.height;
      const key = JSON.stringify(covers);
      if (key === coverKey && !resized && source === pixels && shown?.headingDeg === look.headingDeg && shown.pitchDeg === look.pitchDeg && shown.verticalFovDeg === look.verticalFovDeg) return false;
      if (resized) output = context.createImageData(canvas.width, canvas.height);
      renderPreviewFrame(pixels, face, look, canvas.width, canvas.height, output!.data, covers);
      coverKey = key;
      context.putImageData(output!, 0, 0);
      shown = { ...look };
      source = pixels;
      return true;
    },
  };
}

/** A sheet stays decoded only while a still or live preview owns it. */
export function createPreviewSheetCache(load: (url: string) => Promise<SheetPixels>): {
  acquire(url: string): { pixels: Promise<SheetPixels>; release(): void };
} {
  const entries = new Map<string, { pixels: Promise<SheetPixels>; owners: number }>();
  return {
    acquire(url) {
      let entry = entries.get(url);
      if (!entry) {
        const fresh = { pixels: load(url), owners: 0 };
        fresh.pixels = fresh.pixels.catch((error: unknown) => {
          if (entries.get(url) === fresh) entries.delete(url);
          throw error;
        });
        entries.set(url, fresh);
        entry = fresh;
      }
      entry.owners++;
      const owned = entry;
      let released = false;
      return {
        pixels: entry.pixels,
        release() {
          if (released) return;
          released = true;
          if (--owned.owners === 0 && entries.get(url) === owned) entries.delete(url);
        },
      };
    },
  };
}

const sheets = new WeakMap<Document, ReturnType<typeof createPreviewSheetCache>>();
function acquireSheetPixels(document: Document, url: string) {
  let cache = sheets.get(document);
  if (!cache) { cache = createPreviewSheetCache(href => loadSheetPixels(document, href)); sheets.set(document, cache); }
  return cache.acquire(url);
}

function loadSheetPixels(document: Document, url: string): Promise<SheetPixels> {
  return new Promise<SheetPixels>((resolve, reject) => {
    const Image = document.defaultView?.Image;
    if (!Image) { reject(new Error("preview")); return; }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context || !image.naturalWidth || !image.naturalHeight) { reject(new Error("preview")); return; }
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ width: imageData.width, height: imageData.height, data: imageData.data });
    };
    image.onerror = () => reject(new Error("preview"));
    image.crossOrigin = "anonymous";
    image.src = url;
  });
}


export function createCpuPreviewBackend(): PreviewBackend {
  return {
    create(canvas, face, ready) {
      const owner = canvas.ownerDocument;
      const sheet = acquireSheetPixels(owner.defaultView?.frameElement?.ownerDocument ?? owner, face.url);
      const painter = createPreviewPainter(canvas, face);
      let pixels: SheetPixels | null = null, dead = false;
      void sheet.pixels.then(value => { if (!dead) { pixels = value; ready(); } }, () => undefined);
      return { paint: (look, covers) => pixels ? painter.paint(pixels, look, covers) : false,
        destroy() { dead = true; pixels = null; sheet.release(); } };
    },
    destroy() {},
  };
}
