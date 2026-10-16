import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { createScenesPanel } from "../src/panel.js";
import type { SceneController, SceneControllerState, SceneEntryStatus, SceneStatus } from "../src/browser.js";

const probe = vi.hoisted(() => ({ paints: new Map<string, number>(), live: null as null | { id: string; look: { headingDeg: number; pitchDeg: number; verticalFovDeg: number }; move(look: { headingDeg: number; pitchDeg: number; verticalFovDeg: number }): void } }));
vi.mock("../src/miniViewer.js", async original => ({
  ...await original<typeof import("../src/miniViewer.js")>(),
  createPreviewStill(options: { document: Document; id: string; look: object }) {
    const canvas = options.document.createElement("canvas");
    const paint = (look: object) => {
      canvas.dataset.look = JSON.stringify(look);
      probe.paints.set(options.id, (probe.paints.get(options.id) ?? 0) + 1);
    };
    paint(options.look);
    return { canvas, setLook(look: object) { if (canvas.dataset.look !== JSON.stringify(look)) paint(look); }, destroy() {} };
  },
  createMiniViewer(options: { document: Document; id: string; look: { headingDeg: number; pitchDeg: number; verticalFovDeg: number }; onLook(look: object): void }) {
    const frame = options.document.createElement("iframe");
    let look = { ...options.look };
    const live = { id: options.id, look, move(next: typeof look) { look = { ...next }; live.look = look; options.onLook(look); } };
    probe.live = live;
    return { id: options.id, frame, getLook: () => look, setLook: live.move, fit() {}, destroy() { options.onLook(look); frame.remove(); } };
  },
}));

it("Look up paints every expanded photograph once; hover preserves that frame and each photograph's later look", () => {
  probe.paints.clear(); probe.live = null;
  const dom = new JSDOM("<main></main>", { url: "https://tour.example/tour/twin-cities/" }), document = dom.window.document;
  const level = { headingDeg: 0, pitchDeg: 0, verticalFovDeg: 90 };
  const zenith = { ...level, pitchDeg: 85 };
  let last = level, stored = level, fixed = false, openingChanged = () => {};
  const entry = (id: string): SceneEntryStatus => ({ id, title: id, supported: true, preview: "ready", placement: "placed", description: null, message: null, marker: null, capture: null, pose: null, attribution: null, previewDetail: null, images: [], links: [], previewFace: { url: "https://photos.example/sheet.jpg", sheetWidth: 384, sheetHeight: 64, x: 128, y: 0, size: 64, originX: 0 } });
  const status: SceneStatus = { phase: "overview", active: null, target: null, sceneId: "scene", revision: "r1", title: "Photographs", generation: 1, hovered: null, entries: [entry("a"), entry("b")], groups: [], layers: [{ id: "outdoor", title: "Outdoor", kind: "panoramas", visible: true, shown: true, enabled: true, drawn: true, members: ["a", "b"], layers: [] }], credits: [], overview: "none", warnings: [], renderingAvailable: true, unavailableReason: null, lastError: null, view: null };
  const state: SceneControllerState = { status, errors: [], loading: null };
  const controller = { state: () => state, examples: [], handle: () => null, subscribe(listener: (value: SceneControllerState) => void) { listener(state); return () => {}; } } as unknown as SceneController;
  const makePanel = () => createScenesPanel({ document, controller,
    ui: { parameterSection: ({ main }) => ({ element: main, destroy() {} }), sections(items) { const element = document.createElement("div"); element.append(...items.map(item => item.element)); return { element, destroy() {} }; } },
    opening: { mode: () => fixed ? "fixed" : "last", setMode() {}, lookUp() { if (!fixed) { fixed = true; stored = { ...zenith, pitchDeg: 40 }; openingChanged(); stored = zenith; openingChanged(); } }, lookFor: () => fixed ? stored : last, remember(_id, look) { last = look; }, subscribe(listener) { openingChanged = listener; return () => {}; } },
  });
  let panel = makePanel();
  document.querySelector("main")!.append(panel.element);
  const hover = (id: string) => panel.element.querySelector(`.foss-earth-scene-card[data-sphere='${id}']`)!.dispatchEvent(new dom.window.Event("pointerenter"));
  const shown = (id: string) => JSON.parse(panel.element.querySelector<HTMLCanvasElement>(`.foss-earth-scene-card[data-sphere='${id}'] canvas`)!.dataset.look!);
  try {
    panel.element.querySelector<HTMLButtonElement>(".foss-earth-scene-group-toggle")!.click();
    expect(shown("a")).toEqual(level); expect(shown("b")).toEqual(level);
    [...panel.element.querySelectorAll("button")].find(button => button.textContent === "Look up")!.click();
    expect(shown("a")).toEqual(zenith); expect(shown("b")).toEqual(zenith);
    expect(probe.paints.get("a")).toBe(2); expect(probe.paints.get("b")).toBe(2);
    hover("b"); expect(probe.live?.look).toEqual(shown("b"));
    hover("a"); expect(probe.live?.look).toEqual(shown("a"));
    expect(probe.paints.get("a")).toBe(2); expect(probe.paints.get("b")).toBe(2);
    const turned = { ...zenith, headingDeg: 123, pitchDeg: 20 };
    probe.live!.move(turned);
    hover("b"); expect(shown("a")).toEqual(turned);
    hover("a"); expect(probe.live?.look).toEqual(turned);
    expect(panel.element.querySelectorAll("iframe")).toHaveLength(1);
    // Clicking Look up again must work even when the stored settings are already zenith.
    [...panel.element.querySelectorAll("button")].find(button => button.textContent === "Look up")!.click();
    expect(shown("a")).toEqual(zenith); expect(shown("b")).toEqual(zenith);
    hover("b"); expect(probe.live?.look).toEqual(zenith);
    probe.live!.move(turned);
    [...panel.element.querySelectorAll("button")].find(button => button.textContent === "Tour stops")!.click();
    panel.destroy();
    panel = makePanel();
    document.querySelector("main")!.replaceChildren(panel.element);
    expect(panel.element.querySelectorAll(".is-expanded")).toHaveLength(2);
    expect([...panel.element.querySelectorAll("button")].find(button => button.textContent === "Tour stops")?.getAttribute("aria-pressed")).toBe("true");
    expect(shown("b")).toEqual(turned);
    hover("a"); expect(probe.live?.look).toEqual(zenith);

  } finally { panel.destroy(); dom.window.close(); }
});
