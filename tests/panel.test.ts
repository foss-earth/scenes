import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createScenesPanel, createSceneHotspots, type ScenePanelSection } from "../src/panel.js";
import type { SceneController, SceneControllerState, SceneHandle } from "../src/browser.js";
function setup() {
  const dom = new JSDOM("<main></main>"), document = dom.window.document;
  const listeners = new Set<(state: SceneControllerState) => void>(), frames = new Set<() => void>();
  let state: SceneControllerState = { loading: null, errors: [], status: null }, active: SceneHandle | null = null;
  const controller: SceneController = { examples: [{ id: "tour", title: "Host tour", description: "Explicit host scene", url: "tour.json" }], state: () => state, handle: () => active, load: vi.fn(async () => true), unload: vi.fn(), consumePointerPress: vi.fn(), subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; }, onFailure: () => () => {}, onProgress: () => () => {}, whenSettled: async () => {}, destroy() {} };
  const sections: ScenePanelSection[] = [], destroys: string[] = [];
  const ui = {
    parameterSection(options: { section: string; main: HTMLElement }) { return { element: options.main, destroy() { destroys.push(options.section); } }; },
    sections(items: readonly ScenePanelSection[]) { sections.push(...items); const element = document.createElement("div"); for (const item of items) element.append(item.element); return { element, destroy() { destroys.push("sections"); } }; },
  };
  const set = (next: SceneControllerState): void => { state = next; for (const listener of listeners) listener(state); };
  const frameHandle = { hotspots: () => [{ id: "link", label: "Authored link", x: 12, y: 24 }], follow: vi.fn(async () => ({ ok: true })), onFrame(listener: () => void) { frames.add(listener); return () => { frames.delete(listener); }; } } as unknown as SceneHandle;
  return { dom, document, controller, listeners, sections, destroys, ui, set, frames, frameHandle, activate(value: SceneHandle | null) { active = value; set(state); } };
}
describe("injected Scenes presentation", () => {
  it("keeps one Content/Credits home and accepts foreign sections in original order", () => {
    const host = setup(), foreign = host.document.createElement("div"); foreign.textContent = "Owner loading controls";
    const contribution = { section: "loading" as const, title: "Loading and memory", element: foreign, destroy: vi.fn() };
    const panel = createScenesPanel({ document: host.document, controller: host.controller, ui: host.ui, contributions: [contribution] });
    try {
      host.document.querySelector("main")!.append(panel.element);
      expect(host.sections.map(section => section.id)).toEqual(["scenes.content", "scenes.loading", "scenes.credits"]); expect(host.sections[0].defaultOpen).toBe(true);
      expect(host.controller.load).not.toHaveBeenCalled(); const input = panel.element.querySelector<HTMLInputElement>("input")!; input.value = "https://host.example/tour.json"; input.dispatchEvent(new host.dom.window.KeyboardEvent("keydown", { key: "Enter" })); expect(host.controller.load).toHaveBeenCalledWith(input.value);
      const offered = [...panel.element.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Host tour")!; offered.click(); expect(host.controller.load).toHaveBeenCalledWith("tour", { exampleId: true });
      host.set({ loading: null, errors: [{ path: "$", message: "<img src=x onerror=alert(1)>" }], status: null }); expect(panel.element.querySelector("img")).toBeNull(); expect(panel.element.textContent).toContain("<img src=x");
    } finally { panel.destroy(); panel.destroy(); expect(host.listeners.size).toBe(0); expect(host.destroys).toEqual(["content", "credits", "sections"]); expect(contribution.destroy).toHaveBeenCalledTimes(1); host.dom.window.close(); }
  });
  it("anchors links on supplied frames and releases overlay subscriptions", () => {
    const host = setup(), container = host.document.querySelector<HTMLElement>("main")!, overlay = createSceneHotspots({ document: host.document, controller: host.controller, container });
    try {
      host.activate(host.frameHandle); expect(host.frames.size).toBe(1); for (const frame of host.frames) frame(); const button = container.querySelector<HTMLButtonElement>(".foss-earth-scene-hotspot")!; expect(button.textContent).toBe("Authored link"); expect(button.style.transform).toContain("12px, 24px"); button.click(); expect(host.frameHandle.follow).toHaveBeenCalledWith("link");
      host.activate(null); expect(host.frames.size).toBe(0); expect(container.querySelector("button")).toBeNull();
    } finally { overlay.destroy(); overlay.destroy(); expect(host.listeners.size).toBe(0); expect(container.childElementCount).toBe(0); host.dom.window.close(); }
  });
});
