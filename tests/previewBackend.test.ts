import { expect, it, vi } from "vitest";
import { createPreviewBackends, type PreviewBackend } from "../src/previewBackend.js";

const look = { headingDeg: 0, pitchDeg: 0, verticalFovDeg: 90 };
const face = { url: "https://example.com/sheet.jpg", x: 0, y: 0, originX: 0, size: 64, sheetWidth: 384, sheetHeight: 64 };
const canvas = () => ({ width: 88, height: 88 }) as HTMLCanvasElement;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function backend() {
  const paint = vi.fn(() => true), destroy = vi.fn();
  const value: PreviewBackend = { create: vi.fn(() => ({ paint, destroy })), destroy: vi.fn() };
  return { value, paint, destroy };
}
it("loads nothing before a preview is used and never loads CPU after GPU succeeds", async () => {
  const gpu = backend(), cpu = backend();
  const loadGpu = vi.fn(async () => gpu.value), loadCpu = vi.fn(async () => cpu.value);
  const router = createPreviewBackends({ loadGpu, loadCpu });
  expect(loadGpu).not.toHaveBeenCalled(); expect(loadCpu).not.toHaveBeenCalled();
  const a = router.create(canvas(), face, () => {}), b = router.create(canvas(), face, () => {});
  a.paint(look); b.paint(look);
  await settle();
  expect(loadGpu).toHaveBeenCalledTimes(1); expect(loadCpu).not.toHaveBeenCalled();
  expect(gpu.paint).toHaveBeenCalledTimes(2);
  a.paint(look); expect(gpu.paint).toHaveBeenCalledTimes(2);
  router.destroy(); expect(gpu.value.destroy).toHaveBeenCalledTimes(1);
});
it("coalesces pending looks, preserves the latest pose on failure, and shares the CPU fallback", async () => {
  let resolve!: (value: PreviewBackend) => void;
  const gpu = backend(), cpu = backend();
  gpu.paint.mockImplementation(() => { throw Error("device lost"); });
  const loadCpu = vi.fn(async () => cpu.value);
  const router = createPreviewBackends({ loadGpu: () => new Promise(done => { resolve = done; }), loadCpu });
  const surface = router.create(canvas(), face, () => {});
  surface.paint(look); surface.paint({ ...look, pitchDeg: 85 });
  await settle(); resolve(gpu.value); await settle();
  expect(loadCpu).toHaveBeenCalledTimes(1);
  expect(cpu.paint).toHaveBeenLastCalledWith({ ...look, pitchDeg: 85 }, []);
  router.create(canvas(), face, () => {}).paint(look); await settle();
  expect(loadCpu).toHaveBeenCalledTimes(1);
  router.destroy();
});
it("falls back only after an actual GPU initialization failure and retires a pending backend", async () => {
  const cpu = backend(), loadCpu = vi.fn(async () => cpu.value);
  const router = createPreviewBackends({ loadGpu: async () => { throw Error("unsupported"); }, loadCpu });
  const surface = router.create(canvas(), face, () => {});
  surface.paint(look); await settle();
  expect(loadCpu).toHaveBeenCalledTimes(1);
  surface.destroy(); router.destroy();
  let resolve!: (value: PreviewBackend) => void;
  const gpu = backend();
  const pending = createPreviewBackends({ loadGpu: () => new Promise(done => { resolve = done; }), loadCpu });
  pending.create(canvas(), face, () => {}).paint(look); await settle();
  pending.destroy(); resolve(gpu.value); await settle();
  expect(gpu.value.create).not.toHaveBeenCalled(); expect(gpu.value.destroy).toHaveBeenCalledTimes(1);
});
it("does not repaint when an expanding title covers the old title and indicator; reveals repaint once", async () => {
  const gpu = backend();
  const router = createPreviewBackends({ loadGpu: async () => gpu.value });
  const surface = router.create(canvas(), face, () => {});
  const title = { x: 0, y: 0, width: .8, height: .25, radius: 0 };
  const indicator = { x: .8, y: 0, width: .2, height: .2, radius: .1 };
  surface.paint(look, [title, indicator]); await settle();
  expect(gpu.paint).toHaveBeenCalledTimes(1);
  surface.paint(look, [{ ...title, width: 1 }]);
  expect(gpu.paint).toHaveBeenCalledTimes(1);
  surface.paint(look, [title]);
  expect(gpu.paint).toHaveBeenCalledTimes(2);
  surface.paint(look, [title]); expect(gpu.paint).toHaveBeenCalledTimes(2);
  surface.paint({ ...look, pitchDeg: 85 }, [title]); expect(gpu.paint).toHaveBeenCalledTimes(3);
  router.destroy();
});
