import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { createScenesPanel, type PreviewBackend } from "../src/panel.js";
import { scenesPanelUi } from "./panelUi.js";
import type { SceneController, SceneControllerState, SceneEntryStatus, SceneStatus } from "../src/browser.js";

vi.mock("../src/miniViewer.js", async original => ({
  ...await original<typeof import("../src/miniViewer.js")>(),
  createMiniViewer(options: { document: Document; id: string; look: object }) {
    const frame = options.document.createElement("iframe");
    return { frame, id: options.id, getLook: () => options.look, setLook() {}, fit() {}, destroy() { frame.remove(); } };
  },
}));
it("hides the indicator after two seconds, widens a long title, and reuses the masked frame across hover/rebuild", async () => {
  vi.useFakeTimers();
  const dom = new JSDOM("<main></main>"), document = dom.window.document;
  let now = 0;
  vi.spyOn(dom.window.performance, "now").mockImplementation(() => now);
  vi.spyOn(dom.window.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const mark = this.classList.contains("foss-earth-scene-entry__mark");
    const title = this.classList.contains("foss-earth-scene-entry__title");
    const width = mark ? 16 : title && !this.closest(".is-indicator-hidden") ? 72 : 88;
    return { x: mark ? 72 : 0, y: 0, left: mark ? 72 : 0, top: 0, width, height: mark || title ? 16 : 88, right: 88, bottom: 88, toJSON() {} };
  });
  const entry: SceneEntryStatus = { id: "a", title: "A very long photograph title across the whole top", supported: true, preview: "ready", placement: "placed", description: null, message: null, marker: null, capture: null, pose: null, attribution: null, previewDetail: null, images: [], links: [], previewFace: { url: "https://example.com/sheet.jpg", x: 128, y: 0, originX: 0, size: 64, sheetWidth: 384, sheetHeight: 64 } };
  const status: SceneStatus = { phase: "overview", active: null, target: null, sceneId: "scene", revision: "r1", title: "Scene", generation: 1, hovered: null, entries: [entry], groups: [], layers: [{ id: "outdoor", title: "Outdoor", kind: "panoramas", visible: true, shown: true, enabled: true, drawn: true, members: ["a"], layers: [] }], credits: [], overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null };
  const state: SceneControllerState = { status, errors: [], loading: null };
  const controller = { state: () => state, examples: [], handle: () => null, subscribe(listener: (value: SceneControllerState) => void) { listener(state); return () => {}; } } as unknown as SceneController;
  const draw = vi.fn(() => true);
  const backend: PreviewBackend = { create: () => ({ paint: draw, destroy() {} }), destroy() {} };
  const panel = createScenesPanel({ document, controller, previewBackend: async () => backend,
    ui: { ...scenesPanelUi(document), parameterSection: ({ main }) => ({ element: main, destroy() {} }), sections(items) { const element = document.createElement("div"); element.append(...items.map(item => item.element)); return { element, destroy() {} }; } },
  });
  try {
    document.querySelector("main")!.append(panel.element);
    panel.element.querySelector<HTMLButtonElement>(".foss-earth-scene-group-toggle")!.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(draw).toHaveBeenCalledTimes(1); expect(draw.mock.calls[0][1]).toHaveLength(2);
    now = 2000; vi.advanceTimersByTime(2000);
    expect(panel.element.querySelector<HTMLElement>(".foss-earth-scene-entry__mark")!.hidden).toBe(true);
    expect(panel.element.querySelector(".is-indicator-hidden")).not.toBeNull();
    expect(draw).toHaveBeenCalledTimes(1);
    panel.element.querySelector(".foss-earth-scene-card")!.dispatchEvent(new dom.window.Event("pointerenter"));
    panel.element.querySelector<HTMLInputElement>("input[type=radio][aria-label='Tour stops']")!.click();
    expect(panel.element.querySelector<HTMLElement>(".foss-earth-scene-entry__mark")!.hidden).toBe(true);
    expect(draw).toHaveBeenCalledTimes(1);
  } finally { panel.destroy(); vi.useRealTimers(); dom.window.close(); }
});
