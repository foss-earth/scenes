import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createSceneController, type SceneControllerOptions, type SceneHandle, type SceneStatus, type LoadSceneResult } from "../src/browser.js";
const examples = [{ id: "tour", title: "Host tour", description: "Host-owned scene", url: "tour.json" }];
function handle(): SceneHandle {
  const status: SceneStatus = { phase: "overview", active: null, target: null, sceneId: "tour", revision: "r1", title: "Host tour", generation: 1, hovered: null, entries: [], groups: [], credits: [], overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null };
  const created: SceneHandle = { status, disposed: false, enter: vi.fn(async () => ({ ok: true as const })), follow: vi.fn(async () => ({ ok: true as const })), exit: vi.fn(async () => ({ ok: true as const })), replace: vi.fn(async () => ({ ok: true as const })), showOverview: vi.fn(async () => ({ ok: true as const })), pick: vi.fn(() => ["a"]), hover: vi.fn(), hotspots: () => [], subscribe(listener) { listener(status); return vi.fn(); }, onFrame: () => vi.fn(), whenSettled: async () => {}, dispose: vi.fn() };
  return created;
}
describe("one injected app scene controller", () => {
  it("resolves only registered shareable IDs and preserves a current handle after failure", async () => {
    const mounted = handle(), loader = vi.fn(async () => ({ ok: true as const, handle: mounted }));
    const controller = createSceneController({ examples, baseUrl: "https://host.example/app/", load: loader });
    expect(await controller.load("https://arbitrary.example/scene.json", { exampleId: true })).toBe(false); expect(loader).not.toHaveBeenCalled();
    expect(await controller.load("tour", { exampleId: true })).toBe(true); expect(loader).toHaveBeenCalledWith("https://host.example/app/tour.json", expect.any(Object));
    vi.mocked(mounted.replace).mockResolvedValueOnce({ ok: false, errors: [{ path: "$.version", message: "Not supported" }] });
    expect(await controller.load("another.json")).toBe(false); expect(controller.handle()).toBe(mounted); expect(mounted.dispose).not.toHaveBeenCalled(); controller.destroy(); expect(mounted.dispose).toHaveBeenCalledTimes(1);
  });
  it("aborts superseded requests and disposes a late successful load", async () => {
    const late = handle(), winner = handle(); let resolve!: (result: LoadSceneResult) => void; const first = new Promise<LoadSceneResult>(yes => { resolve = yes; });
    const loader = vi.fn<SceneControllerOptions["load"]>().mockImplementationOnce(() => first).mockResolvedValueOnce({ ok: true, handle: winner });
    const controller = createSceneController({ examples, baseUrl: "https://host.example/", load: loader });
    const old = controller.load("first.json"), signal = loader.mock.calls[0][1].signal; expect(await controller.load("second.json")).toBe(true); expect(signal.aborted).toBe(true);
    resolve({ ok: true, handle: late }); expect(await old).toBe(false); expect(late.dispose).toHaveBeenCalledTimes(1); expect(controller.handle()).toBe(winner); controller.destroy(); await controller.whenSettled();
  });
  it("keeps drag, multitouch and cancelled pointers from activating, without consuming camera gestures", async () => {
    const dom = new JSDOM("<div id='canvas'></div>"), canvas = dom.window.document.querySelector<HTMLElement>("#canvas")!, mounted = handle();
    const controller = createSceneController({ examples, baseUrl: "https://host.example/", canvas, dragThresholdPx: () => 5, load: async () => ({ ok: true, handle: mounted }) });
    const pointer = (type: string, id: number, x = 0, pointerType = "touch"): void => { const event = new dom.window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: id, clientX: x, clientY: 0, pointerType, button: 0, buttons: type === "pointermove" ? 1 : 0 }); canvas.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); };
    try {
      await controller.load("tour", { exampleId: true });
      pointer("pointerdown", 1); pointer("pointermove", 1, 6); pointer("pointerup", 1, 6);
      pointer("pointerdown", 1); pointer("pointerdown", 2); pointer("pointerup", 1); pointer("pointerup", 2);
      pointer("pointerdown", 1); pointer("pointercancel", 1); pointer("pointerup", 1); expect(mounted.enter).not.toHaveBeenCalled();
      pointer("pointerdown", 1); pointer("pointerup", 1); await controller.whenSettled(); expect(mounted.enter).toHaveBeenCalledTimes(1);
      pointer("pointerdown", 1); controller.consumePointerPress(1); pointer("pointerup", 1); await controller.whenSettled(); expect(mounted.enter).toHaveBeenCalledTimes(1);
      controller.consumePointerPress(99);
      controller.destroy(); pointer("pointerdown", 1); pointer("pointerup", 1); expect(mounted.enter).toHaveBeenCalledTimes(1);
    } finally { controller.destroy(); dom.window.close(); }
  });
  it("rejects duplicate catalogue IDs and unsafe URLs before calling the loader", async () => {
    const loader = vi.fn(); expect(() => createSceneController({ examples: [examples[0], examples[0]], baseUrl: "https://host.example/", load: loader })).toThrow(/unique/);
    const controller = createSceneController({ examples, baseUrl: "https://host.example/", load: loader });
    expect(await controller.load("https://token@host.example/scene.json")).toBe(false); expect(loader).not.toHaveBeenCalled(); controller.destroy(); expect(await controller.load("tour", { exampleId: true })).toBe(false);
  });
});
