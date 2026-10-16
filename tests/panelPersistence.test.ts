import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { createScenesPanel } from "../src/panel.js";
import type { SceneController, SceneControllerState, SceneEntryStatus, SceneHandle, SceneLayerStatus, SceneStatus } from "../src/browser.js";

const key = "foss-earth.scene-panel.v1:/tour/twin-cities/";
function browser(raw?: string) {
  const dom = new JSDOM("<main></main>", { url: "https://example.com/tour/twin-cities/" });
  if (raw) dom.window.localStorage.setItem(key, raw);
  let state: SceneControllerState = { loading: null, status: null, errors: [] };
  const listeners = new Set<(state: SceneControllerState) => void>();
  const emit = () => { for (const listener of [...listeners]) listener(state); };
  const setLayerVisible = vi.fn((id: string, visible: boolean) => {
    const walk = (layers: readonly SceneLayerStatus[], ancestor: boolean): SceneLayerStatus[] => layers.map(layer => {
      const own = layer.id === id ? visible : layer.visible;
      return { ...layer, visible: own, shown: ancestor && own, layers: walk(layer.layers, ancestor && own) };
    });
    state = { ...state, status: { ...state.status!, layers: walk(state.status!.layers, true) } }; emit(); return true;
  });
  const handle = { get status() { return state.status; }, setLayerVisible } as unknown as SceneHandle;
  const controller = { examples: [], state: () => state, handle: () => state.status ? handle : null,
    subscribe(listener: (state: SceneControllerState) => void) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
  } as unknown as SceneController;
  const ui = { parameterSection: ({ main }: { main: HTMLElement }) => ({ element: main, destroy() {} }),
    sections(items: readonly { element: HTMLElement }[]) { const element = dom.window.document.createElement("div"); element.append(...items.map(item => item.element)); return { element, destroy() {} }; } };
  const panel = createScenesPanel({ document: dom.window.document, controller, ui });
  dom.window.document.querySelector("main")!.append(panel.element);
  const load = () => {
    const entry = (id: string): SceneEntryStatus => ({ id, title: id, supported: true, placement: "placed", preview: "ready", description: null, message: null, marker: null, capture: null, pose: null, attribution: null, previewDetail: null, images: [], links: [] });
    const child = (id: string, members: string[]): SceneLayerStatus => ({ id: `${id}-360`, title: "360 images", kind: "panoramas", members, layers: [], visible: true, shown: true, enabled: true, drawn: true });
    const group = (id: string, title: string, members: string[]): SceneLayerStatus => ({ id, title, members: [], layers: [child(id, members)], visible: true, shown: true, enabled: true, drawn: false });
    const status: SceneStatus = { phase: "overview", active: null, target: null, sceneId: "tour", revision: "r1", title: "Tour", generation: (state.status?.generation ?? 0) + 1, hovered: null,
      entries: [entry("a"), entry("b"), entry("c")], groups: [], layers: [group("outdoor", "Outdoor", ["a", "b"]), group("indoor", "Indoor", ["c"])], credits: [], overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null };
    state = { ...state, status }; emit();
  };
  const checkbox = (label: string) => panel.element.querySelector<HTMLInputElement>(`input[aria-label='${label}']`)!;
  const tick = (label: string, value: boolean) => { const box = checkbox(label); box.checked = value; box.dispatchEvent(new dom.window.Event("change")); };
  const press = (label: string) => [...panel.element.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label || button.textContent === label)!.click();
  const expanded = () => [...panel.element.querySelectorAll<HTMLElement>(".foss-earth-scene-card.is-expanded")].map(card => card.dataset.sphere).sort();
  return { dom, panel, controller, load, tick, checkbox, press, expanded, setLayerVisible,
    reloadData() { dom.window.dispatchEvent(new dom.window.Event("pagehide")); return dom.window.localStorage.getItem(key)!; },
    destroy() { panel.destroy(); dom.window.close(); },
  };
}
it("restores nested layer tickboxes and mixed photograph sizes in a fresh page before the pending save timer fires", () => {
  vi.useFakeTimers();
  const first = browser();
  let next: ReturnType<typeof browser> | null = null;
  try {
    first.load();
    const target = first.panel.element.querySelector(".foss-earth-scene-card[data-sphere='a'] button")!;
    const down = new first.dom.window.Event("pointerdown", { bubbles: true });
    Object.assign(down, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    target.dispatchEvent(down); vi.advanceTimersByTime(500);
    first.press("Maximize all in Indoor");
    first.tick("Outdoor", false); first.tick("Indoor, 360 images", false);
    first.press("Tour stops");
    expect(first.expanded()).toEqual(["a", "c"]);
    const raw = first.reloadData();
    next = browser(raw); // Different Document, storage and controller, initially no loaded scene.
    next.load();
    expect(next.expanded()).toEqual(["a", "c"]);
    expect(next.checkbox("Outdoor").checked).toBe(false);
    expect(next.checkbox("Outdoor, 360 images").checked).toBe(true);
    expect(next.checkbox("Indoor").checked).toBe(true);
    expect(next.checkbox("Indoor, 360 images").checked).toBe(false);
    expect(next.setLayerVisible).toHaveBeenCalledTimes(2);
    expect(next.controller.state().status!.layers[0].layers[0].shown).toBe(false);
    expect([...next.panel.element.querySelectorAll("button")].find(button => button.textContent === "Tour stops")!.getAttribute("aria-pressed")).toBe("true");
    next.load(); // Scene replacement also restores instead of overwriting with authored defaults.
    expect(next.checkbox("Outdoor").checked).toBe(false);
    expect(next.expanded()).toEqual(["a", "c"]);
  } finally { next?.destroy(); first.destroy(); vi.useRealTimers(); }
});
it("keeps all-minimized groups minimized across reloads and reads existing photograph-only saves", () => {
  const first = browser(JSON.stringify({ version: 1, scenes: { tour: { grouping: "layers", expanded: ["a", "deleted"], active: "deleted", looks: {} } } }));
  let next: ReturnType<typeof browser> | null = null;
  try {
    first.load(); expect(first.expanded()).toEqual(["a"]);
    first.press("Maximize all in Outdoor"); first.press("Minimize all in Outdoor");
    next = browser(first.reloadData()); next.load();
    expect(next.expanded()).toEqual([]);
    expect(next.checkbox("Outdoor").checked).toBe(true);
  } finally { next?.destroy(); first.destroy(); }
});
