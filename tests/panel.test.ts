import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createScenesPanel, createSceneHotspots, type SceneLayerArrangement, type ScenePanelSection } from "../src/panel.js";
import { scenesPanelUi } from "./panelUi.js";
import type { SceneController, SceneControllerState, SceneEntryStatus, SceneHandle, SceneLayerStatus, SceneStatus } from "../src/browser.js";
function setup() {
  const dom = new JSDOM("<main></main>"), document = dom.window.document;
  const listeners = new Set<(state: SceneControllerState) => void>(), frames = new Set<() => void>();
  let state: SceneControllerState = { loading: null, errors: [], status: null }, active: SceneHandle | null = null;
  const controller: SceneController = { examples: [{ id: "tour", title: "Host tour", description: "Explicit host scene", url: "tour.json" }], state: () => state, handle: () => active, load: vi.fn(async () => true), unload: vi.fn(), consumePointerPress: vi.fn(), subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; }, onFailure: () => () => {}, onProgress: () => () => {}, whenSettled: async () => {}, destroy() {} };
  const sections: ScenePanelSection[] = [], destroys: string[] = [];
  const ui = {
    ...scenesPanelUi(document),
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
  it("puts a host's image links straight after Content, collapsed, ahead of image settings", () => {
    const host = setup(), part = (section: "links" | "appearance" | "saved", title: string) => ({ section, title, element: host.document.createElement("div"), destroy: vi.fn() });
    const contributions = [part("saved", "Saved images"), part("appearance", "Appearance"), part("links", "Image links")];
    const panel = createScenesPanel({ document: host.document, controller: host.controller, ui: host.ui, contributions });
    try {
      expect(host.sections.map(section => [section.id, section.title, section.defaultOpen])).toEqual([
        ["scenes.content", "Content", true], ["scenes.links", "Image links", false], ["scenes.appearance", "Appearance", false],
        ["scenes.saved", "Saved images", false], ["scenes.credits", "Credits", false]]);
      expect(host.sections[1].element).toBe(contributions[2].element);
      const listen = vi.spyOn(host.dom.window, "addEventListener");
      expect(() => createScenesPanel({ document: host.document, controller: host.controller, ui: host.ui, contributions: [part("links", "A"), part("links", "B")] })).toThrow("unique");
      expect(listen).not.toHaveBeenCalled();
    } finally { panel.destroy(); for (const contribution of contributions) expect(contribution.destroy).toHaveBeenCalledTimes(1); host.dom.window.close(); }
  });
  it("anchors links on supplied frames and releases overlay subscriptions", () => {
    const host = setup(), container = host.document.querySelector<HTMLElement>("main")!, overlay = createSceneHotspots({ document: host.document, controller: host.controller, container });
    try {
      host.activate(host.frameHandle); expect(host.frames.size).toBe(1); for (const frame of host.frames) frame(); const button = container.querySelector<HTMLButtonElement>(".foss-earth-scene-hotspot")!; expect(button.textContent).toBe("Authored link"); expect(button.style.transform).toContain("12px, 24px"); button.click(); expect(host.frameHandle.follow).toHaveBeenCalledWith("link");
      host.activate(null); expect(host.frames.size).toBe(0); expect(container.querySelector("button")).toBeNull();
    } finally { overlay.destroy(); overlay.destroy(); expect(host.listeners.size).toBe(0); expect(container.childElementCount).toBe(0); host.dom.window.close(); }
  });
  it("lists each photograph under its layer and moves it when dropped on the other layer", () => {
    const host = setup();
    const moved = vi.fn(() => true);
    const enter = vi.fn(async () => true);
    const arrangement: SceneLayerArrangement = { count: () => 0, note: () => "None yet.", exportDocument: () => ({ text: "{}\n", filename: "layers.json", disclosures: [] }), reset: vi.fn(), subscribe: () => () => {} };
    let mode: "enter" | "last" | "image" | "fixed" = "enter";
    let openingChanged = () => {};
    const lookUp = vi.fn(() => { mode = "fixed"; openingChanged(); });
    const opening = { mode: () => mode, setMode: (next: typeof mode) => { mode = next; openingChanged(); }, lookUp, lookFor: () => null, remember: vi.fn(), subscribe: (listener: () => void) => { openingChanged = listener; return () => {}; } };
    const panel = createScenesPanel({ document: host.document, controller: host.controller, ui: host.ui, layerArrangement: arrangement, opening });
    const entry = (id: string, title: string, preview: SceneEntryStatus["preview"] = "ready"): SceneEntryStatus => ({ id, title, description: null, supported: true, message: null, placement: "placed", preview, marker: null, capture: null, pose: null, attribution: null, previewDetail: null, images: [], links: [], previewFace: id === "garden" ? { url: "https://photos.example/previews-64.jpg", sheetWidth: 384, sheetHeight: 64, x: 256, y: 0, size: 64, originX: 0 } : null });
    const images = (id: string, members: readonly string[]): SceneLayerStatus => ({ id, title: "360 images", kind: "panoramas", visible: true, shown: true, enabled: true, drawn: true, members, layers: [] });
    const layer = (id: string, title: string, members: readonly string[]): SceneLayerStatus => ({ id, title, visible: true, shown: true, enabled: true, drawn: false, members: [], layers: [images(`${id}-360`, members)] });
    const status: SceneStatus = {
      phase: "overview", active: null, target: null, sceneId: "tour", revision: "r1", title: "Host tour", generation: 1, hovered: null,
      entries: [entry("garden", "Garden"), entry("courtyard", "Courtyard", "loading")], groups: [],
      layers: [layer("outdoor", "Outdoor", ["garden"]), layer("indoor", "Indoor", ["courtyard", "garden"])],
      credits: [], overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null,
    };
    try {
      host.document.querySelector("main")!.append(panel.element);
      host.activate({ movePanorama: moved, enter } as unknown as SceneHandle);
      host.set({ loading: null, errors: [], status });
      const outdoorGroup = panel.element.querySelector<HTMLElement>(".foss-earth-scene-layer-group[data-layer='outdoor']")!;
      const outdoorImages = outdoorGroup?.querySelector(".foss-earth-scene-layer-group[data-layer='outdoor-360']");
      expect(outdoorGroup?.getAttribute("role")).toBe("group");
      expect(outdoorImages?.parentElement).toBe(outdoorGroup);
      expect(outdoorImages?.querySelector(".foss-earth-scene-card[data-sphere='garden']")).not.toBeNull();
      expect(panel.element.querySelectorAll("[style*='padding-left']")).toHaveLength(0);
      const grids = [...panel.element.querySelectorAll(".foss-earth-scene-layer-members")];
      expect(grids.map(grid => [...grid.querySelectorAll(".foss-earth-scene-card")].map(item => item.dataset.sphere))).toEqual([["garden"], ["courtyard"]]);
      const style = host.document.createElement("style");
      style.textContent = readFileSync(new URL("../styles/panel.css", import.meta.url), "utf8");
      host.document.head.append(style);
      const garden = grids[0].querySelector<HTMLElement>(".foss-earth-scene-card")!;
      expect(garden.draggable).toBe(true);
      expect(garden.classList.contains("is-expanded")).toBe(false);
      expect(garden.textContent).toBe("Garden");
      expect(host.dom.window.getComputedStyle(garden).order).toBe("1");
      expect(garden.querySelector(".foss-earth-scene-entry__title")).toBeNull();
      const gardenMark = garden.querySelector(".foss-earth-scene-entry__mark");
      expect(gardenMark).toBeNull();
      expect(garden.querySelector(".foss-earth-scene-entry__picture")).toBeNull();
      const courtyardMark = grids[1].querySelector(".foss-earth-scene-entry__mark");
      expect(courtyardMark).toBeNull();
      expect(panel.element.textContent).not.toContain("Loading preview");
      garden.querySelector("button")!.click();
      expect(enter).toHaveBeenCalledWith("garden");
      expect(panel.element.querySelector(".is-expanded")).toBeNull();
      enter.mockClear();
      vi.useFakeTimers();
      const down = new host.dom.window.Event("pointerdown", { bubbles: true });
      Object.assign(down, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      panel.element.querySelector(".foss-earth-scene-card[data-sphere='garden'] button")!.dispatchEvent(down);
      vi.advanceTimersByTime(500);
      vi.useRealTimers();
      expect(enter).not.toHaveBeenCalled();
      const expanded = panel.element.querySelector<HTMLElement>(".foss-earth-scene-card.is-expanded");
      expect(expanded?.dataset.sphere).toBe("garden");
      expect(host.dom.window.getComputedStyle(expanded!).order).toBe("0");
      expect(host.dom.window.getComputedStyle(expanded!).width).toBe("88px");
      expect(host.dom.window.getComputedStyle(expanded!.querySelector(".foss-earth-scene-entry__frame")!).height).toBe("88px");
      expect(expanded?.querySelector<HTMLElement>(".foss-earth-scene-entry__picture")?.style.backgroundImage).toContain("previews-64.jpg");
      expect(expanded?.querySelector(".foss-earth-scene-entry__mark")?.getAttribute("data-state")).toBe("ready");
      const title = expanded?.querySelector(".foss-earth-scene-entry__title");
      expect(title?.textContent).toBe("Garden");
      expect(title?.parentElement?.className).toBe("foss-earth-scene-entry__frame");
      const titleStyle = host.dom.window.getComputedStyle(title!);
      expect(titleStyle.left).toBe("0px");
      expect(titleStyle.right).toBe("auto");
      expect(titleStyle.padding).toBe("0px");
      const indicatorStyle = host.dom.window.getComputedStyle(expanded!.querySelector(".foss-earth-scene-entry__mark")!);
      expect(indicatorStyle.right).toBe("0px");
      expect(indicatorStyle.left).toBe("auto");
      expect(panel.element.querySelectorAll("iframe")).toHaveLength(1);
      vi.useFakeTimers();
      title!.dispatchEvent(down);
      vi.advanceTimersByTime(500);
      expect(panel.element.querySelector(".is-expanded")).toBeNull();
      expect(enter).not.toHaveBeenCalled();
      panel.element.querySelector(".foss-earth-scene-card[data-sphere='garden'] button")!.dispatchEvent(down);
      vi.advanceTimersByTime(500);
      vi.useRealTimers();
      expect(panel.element.querySelectorAll("iframe")).toHaveLength(1);
      // "Group [Layers / Stops] ?  Opening [Enter / Last / Each / Fixed] ?  [Look up]": one track each, full names spoken.
      const tools = panel.element.querySelector<HTMLElement>(".foss-earth-scene-tools")!;
      expect([...tools.querySelectorAll('[role="radiogroup"]')].map(group => group.getAttribute("aria-label"))).toEqual(["Group", "Opening"]);
      expect([...tools.querySelectorAll<HTMLInputElement>("input[type=radio]")].map(input => [input.getAttribute("aria-label"), input.checked])).toEqual([
        ["Indoor and outdoor", true], ["Tour stops", false], ["On entering", true], ["Last view", false], ["Each photograph", false], ["One position", false]]);
      expect(tools.lastElementChild?.textContent).toBe("Look up");
      tools.querySelector<HTMLInputElement>('input[aria-label="Last view"]')!.click();
      expect(mode).toBe("last");
      expect(panel.element.querySelectorAll("iframe")).toHaveLength(1);
      [...panel.element.querySelectorAll("button")].find(button => button.textContent === "Look up")!.click();
      expect(mode).toBe("fixed");
      expect(lookUp).toHaveBeenCalledOnce();
      expect(panel.element.querySelector<HTMLInputElement>('input[aria-label="One position"]')!.checked).toBe(true);
      // The layer moves' actions are marks with their full names; how to move one is behind Group's ?.
      expect([...panel.element.querySelectorAll(".foss-earth-scene-layer-actions button")].map(node => [(node as HTMLElement).dataset.icon, node.getAttribute("aria-label")])).toEqual([
        ["download", "Download layer moves"], ["copy", "Copy layer moves as JSON"], ["reset", "Reset layers: every photograph back in its published layer"]]);
      expect(panel.element.querySelector(".foss-earth-scene-layer-actions .foss-earth-choices__note")?.hasAttribute("hidden")).toBe(true);
      const live = [...panel.element.querySelectorAll(".foss-earth-scene-layer-members")];
      live[0].querySelector<HTMLElement>(".foss-earth-scene-card")!.dispatchEvent(new host.dom.window.Event("dragstart", { bubbles: true }));
      live[1].dispatchEvent(new host.dom.window.Event("drop", { bubbles: true }));
      expect(moved).toHaveBeenCalledWith("garden", "indoor-360");
      expect(panel.element.textContent).not.toContain("Other photographs");
      expect(panel.element.textContent).not.toContain("Ready");
      vi.useFakeTimers();
      live[0].querySelector<HTMLElement>(".foss-earth-scene-card")!.dispatchEvent(new host.dom.window.Event("dragend", { bubbles: true }));
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
      panel.element.querySelector<HTMLButtonElement>(".foss-earth-scene-entry__title")!.click();
      expect(enter).toHaveBeenCalledWith("garden");
      expect(panel.element.querySelectorAll("iframe")).toHaveLength(0);
      expect(panel.element.querySelectorAll(".is-expanded")).toHaveLength(1);
    } finally { panel.destroy(); host.dom.window.close(); }
  });
  it("titles the scene first, with terse state, marks for its actions and the reasons behind ?, kept open through updates", () => {
    const host = setup();
    const panel = createScenesPanel({ document: host.document, controller: host.controller, ui: host.ui });
    const entry = (id: string, preview: SceneEntryStatus["preview"]): SceneEntryStatus => ({ id, title: id, description: null, supported: true, message: null, placement: "placed", preview, marker: null, capture: null, pose: null, attribution: null, previewDetail: null, images: [], links: [] });
    const status = (ready: number): SceneStatus => ({
      phase: "overview", active: null, target: null, sceneId: "tour", revision: "r1", title: "Host tour", generation: 1, hovered: null,
      entries: [entry("a", ready > 0 ? "ready" : "loading"), entry("b", ready > 1 ? "ready" : "loading")], groups: [], layers: [],
      credits: [], overview: "pending", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null,
    });
    try {
      host.document.querySelector("main")!.append(panel.element);
      host.set({ loading: null, errors: [], status: status(0) });
      // "Host tour [⌖] [×] [?]", then the state lines.
      const head = [...panel.element.querySelectorAll<HTMLElement>(".foss-earth-choices")].find(row => row.firstElementChild?.textContent === "Host tour")!;
      const [go, unload, help] = [...head.querySelectorAll("button")];
      expect([go.dataset.icon, go.getAttribute("aria-label"), unload.dataset.icon, unload.getAttribute("aria-label"), help.getAttribute("aria-label")]).toEqual(["target", "Go to the scene", "close", "Unload the scene", "Explain the scene's state"]);
      const shown = () => [...head.querySelectorAll<HTMLElement>(":scope > p:not([hidden])")].map(line => line.textContent);
      expect(shown()).toEqual(["Overview · 2 entities · revision r1", "0 of 2 previews ready", "Waiting for the ground at the scene's place"]);
      help.click();
      expect(help.getAttribute("aria-expanded")).toBe("true");
      host.set({ loading: null, errors: [], status: { ...status(1), overview: "applied" } });
      expect(help.isConnected).toBe(true);
      expect(help.getAttribute("aria-expanded")).toBe("true");
      expect(go.getAttribute("aria-label")).toBe("Back to the scene's view");
      expect(shown()).toEqual(["Overview · 2 entities · revision r1", "1 of 2 previews ready"]);
      unload.click();
      expect(host.controller.unload).toHaveBeenCalledOnce();
    } finally { panel.destroy(); host.dom.window.close(); }
  });
  it("shows each photograph once and can group the same cards by tour stop", () => {
    const host = setup();
    const panel = createScenesPanel({ document: host.document, controller: host.controller, ui: host.ui });
    const entry = (id: string, title: string): SceneEntryStatus => ({ id, title, description: null, supported: true, message: null, placement: "placed", preview: "ready", marker: null, capture: null, pose: null, attribution: null, previewDetail: null, images: [], links: [], previewFace: { url: "https://photos.example/previews-64.jpg", sheetWidth: 384, sheetHeight: 64, x: 128, y: 0, size: 64, originX: 0 } });
    const images = (id: string, members: readonly string[]): SceneLayerStatus => ({ id, title: "360 images", kind: "panoramas", visible: true, shown: true, enabled: true, drawn: true, members, layers: [] });
    const layer = (id: string, title: string, members: readonly string[]): SceneLayerStatus => ({ id, title, visible: true, shown: true, enabled: true, drawn: false, members: [], layers: [images(`${id}-360`, members)] });
    const status: SceneStatus = {
      phase: "overview", active: null, target: null, sceneId: "tour", revision: "r1", title: "Host tour", generation: 1, hovered: null,
      entries: [entry("garden", "Garden"), entry("courtyard", "Courtyard"), entry("bridge", "Stone Arch Bridge")],
      groups: [
        { id: "welcome", title: "1. Welcome to the UMN Twin Cities (feat. Northrop Mall)", members: ["garden", "courtyard"] },
        { id: "cities", title: "20. The Twin Cities (Our Location & Opportunities)", members: ["garden", "bridge"] },
      ],
      layers: [layer("outdoor", "Outdoor", ["garden", "bridge"]), layer("indoor", "Indoor", ["courtyard", "garden"])],
      credits: [], overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null,
    };
    try {
      host.document.querySelector("main")!.append(panel.element);
      host.set({ loading: null, errors: [], status });
      expect(panel.element.textContent).not.toContain("1. Welcome");
      expect(panel.element.textContent).not.toContain("The Twin Cities");
      expect(panel.element.querySelectorAll(".foss-earth-scene-card[data-sphere='garden']")).toHaveLength(1);
      expect(panel.element.querySelector(".is-expanded")).toBeNull();
      panel.element.querySelector<HTMLInputElement>('input[aria-label="Tour stops"]')!.click();
      const stops = [...panel.element.querySelectorAll(".foss-earth-scene-stop")];
      expect(stops.map(stop => stop.querySelector(".foss-earth-choices__heading")?.textContent)).toEqual([
        "1. Welcome to the UMN Twin Cities (feat. Northrop Mall)",
        "20. The Twin Cities (Our Location & Opportunities)",
      ]);
      expect(stops.map(stop => [...stop.querySelectorAll(".foss-earth-scene-card")].map(card => card.dataset.sphere))).toEqual([["garden", "courtyard"], ["bridge"]]);
      expect(panel.element.querySelectorAll(".foss-earth-scene-card[data-sphere='garden']")).toHaveLength(1);
      expect(panel.element.querySelectorAll(".foss-earth-scene-layer-members:not(.foss-earth-scene-stop)")).toHaveLength(0);
      const maximize = stops[0].querySelector<HTMLButtonElement>(".foss-earth-scene-group-toggle")!;
      expect([maximize.dataset.icon, maximize.getAttribute("aria-label")]).toEqual(["expand-all", "Maximize all in 1. Welcome to the UMN Twin Cities (feat. Northrop Mall)"]);
      maximize.click();
      const style = host.document.createElement("style");
      style.textContent = readFileSync(new URL("../styles/panel.css", import.meta.url), "utf8");
      host.document.head.append(style);
      const assertStill = (id: string) => {
        const picture = panel.element.querySelector<HTMLElement>(`.foss-earth-scene-card[data-sphere='${id}'] .foss-earth-scene-entry__picture`)!;
        expect(picture.style.backgroundImage).toContain("previews-64.jpg");
        expect(host.dom.window.getComputedStyle(picture).height).toBe("88px");
        expect(host.dom.window.getComputedStyle(picture).visibility).toBe("visible");
      };
      assertStill("courtyard");
      expect([...panel.element.querySelectorAll(".foss-earth-scene-card.is-expanded")].map(card => (card as HTMLElement).dataset.sphere)).toEqual(["garden", "courtyard"]);
      expect(panel.element.querySelectorAll("iframe")).toHaveLength(1);
      panel.element.querySelector(".foss-earth-scene-card[data-sphere='courtyard']")!.dispatchEvent(new host.dom.window.Event("pointerenter"));
      expect(panel.element.querySelectorAll("iframe")).toHaveLength(1);
      expect(panel.element.querySelector("iframe")?.closest<HTMLElement>(".foss-earth-scene-card")?.dataset.sphere).toBe("courtyard");
      assertStill("garden");
      const minimize = panel.element.querySelector<HTMLButtonElement>(".foss-earth-scene-stop .foss-earth-scene-group-toggle")!;
      expect(minimize.dataset.icon).toBe("collapse-all");
      minimize.click();
      expect(panel.element.querySelectorAll(".foss-earth-scene-card.is-expanded")).toHaveLength(0);

    } finally { panel.destroy(); host.dom.window.close(); }
  });
});
