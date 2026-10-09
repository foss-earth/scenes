import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createBrowserSceneHistory, createMemorySceneHistory, isSceneHistoryEntry, SCENE_HISTORY_KEY, type SceneHistoryEntry } from "../src/browser.js";
const entry = (destination: string | null): SceneHistoryEntry => ({ v: 1, session: "host-session", sceneId: "tour", revision: "r1", destination, view: destination ? { headingDeg: 10, pitchDeg: 0, verticalFovDeg: 60 } : null });
describe("cooperating scene history", () => {
  it("preserves host state and URL, validates popstate and removes listeners", () => {
    const dom = new JSDOM("", { url: "https://host.example/app?host=1" });
    const window = dom.window as unknown as Window;
    try {
      window.history.replaceState({ host: { own: true } }, "");
      const history = createBrowserSceneHistory(window), events: unknown[] = [], off = history.subscribe(value => events.push(value));
      history.record(entry(null), "replace"); history.record(entry("a"), "push");
      expect(window.history.state.host).toEqual({ own: true }); expect(window.location.href).toBe("https://host.example/app?host=1");
      window.dispatchEvent(new dom.window.PopStateEvent("popstate", { state: { [SCENE_HISTORY_KEY]: entry("a") } }));
      window.dispatchEvent(new dom.window.PopStateEvent("popstate", { state: { [SCENE_HISTORY_KEY]: { ...entry("a"), view: { headingDeg: Infinity } } } }));
      expect(events).toEqual([entry("a"), null]); off(); window.dispatchEvent(new dom.window.PopStateEvent("popstate", { state: { [SCENE_HISTORY_KEY]: entry(null) } })); expect(events).toHaveLength(2);
    } finally { dom.window.close(); }
  });
  it("copies records, traverses without appending and truncates forward history", () => {
    const history = createMemorySceneHistory(), events: unknown[] = [], mutable = entry("a");
    history.subscribe(value => events.push(value)); history.record(entry(null), "replace"); history.record(mutable, "push"); mutable.sceneId = "mutated";
    history.record(entry("b"), "push"); history.back(); expect(events.at(-1)).toEqual(entry("a")); history.forward(); expect(events.at(-1)).toEqual(entry("b"));
    history.back(); history.record(entry("c"), "push"); history.forward(); expect(history.entries().map(value => value.destination)).toEqual([null, "a", "c"]);
    const exposed = history.entries()[0]; exposed.sceneId = "outside"; expect(history.entries()[0].sceneId).toBe("tour");
  });
  it("rejects incomplete, unexpected and nonfinite serialized state", () => {
    expect(isSceneHistoryEntry(entry(null))).toBe(true);
    for (const value of [{ v: 1, session: "x", sceneId: "x" }, { ...entry("a"), token: "unexpected" }, { ...entry("a"), view: { headingDeg: 0, pitchDeg: NaN, verticalFovDeg: 60 } }]) { expect(isSceneHistoryEntry(value)).toBe(false); expect(() => createMemorySceneHistory().record(value as SceneHistoryEntry, "push")).toThrow(); }
  });
});
