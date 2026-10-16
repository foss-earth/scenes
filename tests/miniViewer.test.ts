import { describe, expect, it } from "vitest";
import { imagePoseMatrix, transpose3 } from "@foss-earth/images";
import { createLookModel, sphereRay } from "@foss-earth/sphere-image";
import { sourceCubeLookup } from "@foss-earth/sphere-cubemap";
import { createMiniFrames, createMiniLook, DEFAULT_MINI_NAVIGATION } from "../src/miniViewer.js";
import { createPreviewSheetCache, createPreviewPainter, previewRay, renderPreviewFrame, samplePreview, type SheetPixels } from "../src/miniViewerCpu.js";

const level = { headingDeg: 0, pitchDeg: 0, verticalFovDeg: 90 };

describe("mini panorama look", () => {
  it("looks at the py face from the center and turns the same way a drag does", () => {
    const ray = previewRay(level, 100, 100, 0.5, 0.5);
    expect(ray[0]).toBeCloseTo(0, 5);
    expect(ray[1]).toBeCloseTo(1, 5);
    expect(ray[2]).toBeCloseTo(0, 5);
    expect(sourceCubeLookup(ray).face).toBe("py");
    const model = createMiniLook(level, () => DEFAULT_MINI_NAVIGATION, () => {});
    model.drag(10, -10, 20);
    expect(model.get().headingDeg).toBeCloseTo(358.5, 5);
    expect(model.get().pitchDeg).toBeCloseTo(-1.5, 5);
    model.set(level);
    model.wheel(-100);
    expect(model.get().verticalFovDeg).toBeLessThan(90);
    model.set(level);
    model.pinch(10, 20);
    expect(model.get().verticalFovDeg).toBeLessThan(90);
  });

  it("samples the py face of a preview strip", () => {
    const size = 2;
    const data = new Uint8ClampedArray(6 * size * size * 4);
    const pixels: SheetPixels = { width: 6 * size, height: size, data };
    const py = 2 * size;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const offset = (y * pixels.width + py + x) * 4;
      data[offset] = 200;
      data[offset + 3] = 255;
    }
    const sample = samplePreview(pixels, 0, 0, size, [0, 1, 0]);
    expect(sample?.[0]).toBe(200);
  });
});


describe("mini navigation shared with the full viewer", () => {
  it("carries drag momentum, accepts an interrupting drag immediately, and settles", () => {
    const model = createMiniLook(level, () => DEFAULT_MINI_NAVIGATION, () => {});
    model.drag(-20, 10, 20);
    model.release();
    const released = model.get();
    expect(model.step(20)).toBe(true);
    expect(model.get().headingDeg).toBeGreaterThan(released.headingDeg);
    const gliding = model.get();
    model.drag(-10, 0, 20);
    expect(model.get().headingDeg).toBeCloseTo(gliding.headingDeg + 1.5);
    model.release();
    for (let i = 0; i < 150; i++) model.step(20);
    expect(model.moving()).toBe(false);
  });
  it("respects live gains, limits and reduced motion", () => {
    const nav = { ...DEFAULT_MINI_NAVIGATION, reducedMotion: true, dragSensitivity: 1 };
    const model = createMiniLook(level, () => nav, () => {});
    model.drag(10, 200, 20);
    expect(model.get().pitchDeg).toBe(nav.pitch.max);
    model.release();
    expect(model.step(20)).toBe(false);
    model.wheel(-100);
    expect(model.get().verticalFovDeg).toBeCloseTo(2 * Math.atan(Math.exp(-nav.zoomPerNotch)) * 180 / Math.PI);
  });
});

it("starts a fresh frame clock after idle and draws nothing after settling", () => {
  let now = 0;
  let next: ((time: number) => void) | null = null;
  const steps: number[] = [];
  let moving = false;
  const frames = createMiniFrames({ now: () => now,
    request: callback => { next = callback; return 1; }, cancel() { next = null; },
    step: dt => { steps.push(dt); return moving; }, paint() {},
  });
  const tick = () => { const run = next!; next = null; run(now); };
  frames.request(); now = 16; tick();
  expect(next).toBeNull();
  now = 10000; moving = true; frames.request(); now += 16; tick();
  expect(steps.at(-1)).toBe(16);
  expect(next).not.toBeNull();
  moving = false; now += 16; tick();
  expect(next).toBeNull();
  frames.destroy();
});


it("matches the full sphere camera through anchored wheel, pinch, drag and glide", () => {
  const nav = { ...DEFAULT_MINI_NAVIGATION, dragSensitivity: .23, swipeSensitivity: .12, pinchGain: 1.4, inertiaHalfLifeMs: 170 };
  const viewport = { width: 88, height: 88 };
  const mini = createMiniLook(level, () => nav, () => {}, () => viewport);
  const full = createLookModel(level, () => ({
    ...nav, swipeSensitivity: nav.swipeSensitivity, reducedMotion: false,
    inertiaHalfLifeMs: nav.inertiaHalfLifeMs, fovRangeDeg: nav.fov, pitchRangeDeg: nav.pitch,
    lookRate: 0, zoomRate: 0,
  }), () => {}, () => viewport);
  for (const camera of [mini, full]) {
    camera.drag(12, -7, 16);
    camera.release();
    camera.step(16);
    camera.wheel(-30, { x: 12, y: 20 });
    camera.touchPinch({ mid: { x: 30, y: 30 }, separation: 20 }, { mid: { x: 35, y: 25 }, separation: 28 });
    camera.swipe(4, -5);
  }
  expect(mini.get()).toEqual(full.get());
  expect(previewRay(mini.get(), 88, 88, .2, .7)).toEqual(sphereRay(full.get(), viewport, { x: .2 * 88, y: .7 * 88 }));
});


it("renders a real zenith frame from the same cube sheet as a level frame", () => {
  const size = 4, width = 6 * size;
  const data = new Uint8ClampedArray(width * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    data[offset] = Math.floor(x / size) * 30;
    data[offset + 3] = 255;
  }
  const pixels = { data, width, height: size };
  const face = { url: "sheet", sheetWidth: width, sheetHeight: size, x: 2 * size, originX: 0, y: 0, size };
  const horizon = renderPreviewFrame(pixels, face, level, 3, 3);
  const zenith = renderPreviewFrame(pixels, face, { ...level, pitchDeg: 85 }, 3, 3);
  const center = (1 * 3 + 1) * 4;
  expect(horizon[center]).toBe(60); // py
  expect(zenith[center]).toBe(120); // pz
  expect(zenith).toEqual(renderPreviewFrame(pixels, face, { ...level, pitchDeg: 85 }, 3, 3));
});

it("keeps pixel output identical to the reference projection across poses, rotations and cube faces", () => {
  const width = 6 * 8 + 5, height = 21;
  const pixels = { width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i * 37 + i % 17) % 256) };
  const rotations = [undefined, transpose3(imagePoseMatrix({ headingDeg: 71.3, pitchDeg: 19.7, rollDeg: -8.2 }))];
  for (const content of rotations) for (const headingDeg of [0, 45, 89.9, 180, 270, 359.9]) for (const pitchDeg of [-85, -42.5, 0, 42.5, 85]) {
    const look = { headingDeg, pitchDeg, verticalFovDeg: headingDeg === 45 ? 120 : 75 };
    const face = { url: "sheet", sheetWidth: width, sheetHeight: height, originX: 3, x: 19, y: 7, size: 8, content };
    const w = 17, h = 13, expected = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sample = samplePreview(pixels, face.originX, face.y, face.size, previewRay(look, w, h, (x + .5) / w, (y + .5) / h), content);
      expected.set(sample ?? [11, 18, 32, 255], (y * w + x) * 4);
    }
    expect(renderPreviewFrame(pixels, face, look, w, h)).toEqual(expected);
  }
});

it("can render directly into a reused canvas buffer", () => {
  const pixels = { width: 6, height: 1, data: new Uint8ClampedArray(24).fill(99) };
  const face = { url: "sheet", sheetWidth: 6, sheetHeight: 1, originX: 0, x: 2, y: 0, size: 1 };
  const target = new Uint8ClampedArray(36);
  expect(renderPreviewFrame(pixels, face, level, 3, 3, target)).toBe(target);
  expect(target[3]).toBe(255);
});

it("reuses its pixel buffer and does no drawing for an unchanged pose", () => {
  let allocations = 0, draws = 0;
  const context = {
    createImageData(width: number, height: number) { allocations++; return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData() { draws++; },
  };
  const canvas = { width: 8, height: 8, getContext: () => context } as unknown as HTMLCanvasElement;
  const face = { url: "sheet", sheetWidth: 6, sheetHeight: 1, originX: 0, x: 2, y: 0, size: 1 };
  const pixels = { width: 6, height: 1, data: new Uint8ClampedArray(24).fill(99) };
  const painter = createPreviewPainter(canvas, face);
  expect(painter.paint(pixels, level)).toBe(true);
  expect(painter.paint(pixels, { ...level })).toBe(false);
  painter.paint(pixels, { ...level, pitchDeg: 85 });
  expect(allocations).toBe(1);
  expect(draws).toBe(2);
  canvas.width = 10;
  expect(painter.paint(pixels, { ...level, pitchDeg: 85 })).toBe(true);
  expect(allocations).toBe(2);
});

it("decodes a shared sheet once and releases it when its last preview closes", async () => {
  let loads = 0;
  const pixels = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  const cache = createPreviewSheetCache(async () => { loads++; return pixels; });
  const a = cache.acquire("sheet"), b = cache.acquire("sheet");
  expect(a.pixels).toBe(b.pixels);
  await a.pixels;
  expect(loads).toBe(1);
  a.release(); a.release();
  const c = cache.acquire("sheet");
  expect(c.pixels).toBe(b.pixels);
  b.release(); c.release();
  const d = cache.acquire("sheet");
  await d.pixels;
  expect(loads).toBe(2);
  d.release();
});

it("retries a failed shared sheet without an old release evicting the retry", async () => {
  let loads = 0;
  const cache = createPreviewSheetCache(async () => {
    if (++loads === 1) throw Error("unavailable");
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  });
  const failed = cache.acquire("sheet");
  await expect(failed.pixels).rejects.toThrow("unavailable");
  const retry = cache.acquire("sheet");
  await retry.pixels;
  failed.release();
  const other = cache.acquire("sheet");
  expect(other.pixels).toBe(retry.pixels);
  expect(loads).toBe(2);
  retry.release(); other.release();
});

it("preserves reference texels at cube seams and nearest-neighbor rounding boundaries", () => {
  const pixels = { width: 384, height: 64, data: Uint8ClampedArray.from({ length: 384 * 64 * 4 }, (_, i) => (i * 29 + i % 13) % 256) };
  for (const h of [0, 45, 90, 135, 180, 270]) for (const p of [-45, 0, 45, 85]) for (const pose of [0, 45, 90]) {
    const content = transpose3(imagePoseMatrix({ headingDeg: pose, pitchDeg: pose, rollDeg: pose }));
    const look = { headingDeg: h, pitchDeg: p, verticalFovDeg: 90 };
    const face = { url: "sheet", sheetWidth: 384, sheetHeight: 64, originX: 0, x: 128, y: 0, size: 64, content };
    const width = 9, height = 9;
    const actual = renderPreviewFrame(pixels, face, look, width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const expected = samplePreview(pixels, 0, 0, 64, previewRay(look, width, height, (x + .5) / width, (y + .5) / height), content)!;
      expect([...actual.slice((y * width + x) * 4, (y * width + x + 1) * 4)]).toEqual(expected);
    }
  }
});

it("CPU fallback skips only opaque title pixels and the circular indicator, then fills reveals", () => {
  const data = new Uint8ClampedArray(6 * 2 * 2 * 4).fill(150);
  const pixels = { width: 12, height: 2, data };
  const face = { url: "sheet", x: 0, y: 0, originX: 0, size: 2, sheetWidth: 12, sheetHeight: 2 };
  const target = new Uint8ClampedArray(10 * 10 * 4).fill(42);
  renderPreviewFrame(pixels, face, level, 10, 10, target, [
    { x: 0, y: 0, width: .5, height: .2, radius: 0 },
    { x: .6, y: 0, width: .4, height: .4, radius: .2 },
  ]);
  expect(target[0]).toBe(42); // covered title
  expect(target[(1 * 10 + 8) * 4]).toBe(42); // inside indicator
  expect(target[6 * 4]).toBe(150); // outside circular corner
  expect(target[(5 * 10 + 5) * 4]).toBe(150);
  renderPreviewFrame(pixels, face, level, 10, 10, target);
  expect(target[0]).toBe(150); expect(target[(1 * 10 + 8) * 4]).toBe(150);
});
