import { describe, expect, it } from "vitest";
import { loadScene, type SceneStatus, type SceneViewerImageDetail, type SceneViewerPorts, type SceneViewerStatus, type SceneWorldPorts } from "../src/browser.js";
import { fixtureDocument, fixtureOptions } from "./fixtures.js";

describe("injected viewer detail observations", () => {
  it("passes published readings through updates and clearing without inventing missing detail", async () => {
    let current: SceneViewerStatus = { phase: "overview", active: null, target: null };
    const listeners = new Set<(status: SceneViewerStatus) => void>();
    const publish = (next: SceneViewerStatus): void => {
      current = next;
      for (const listener of [...listeners]) listener(next);
    };
    const viewer: SceneViewerPorts = {
      async prepare(input) { return { id: input.id, async ready() {}, updatePlacement() {}, hover() {}, dispose() {} }; },
      replaceImages() {},
      async enter() { return true; },
      exit() {},
      status: () => current,
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      pick: () => [],
      hover() {},
    };
    const world: SceneWorldPorts = {
      resolvePlacement(_entity, { radiusMeters }) {
        return { state: "pending", placement: { marker: null, radiusMeters, content: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], outline: null, hoverScale: 1 } };
      },
      async showOverview() { return { ok: true, state: "applied" }; },
    };
    const loaded = await loadScene(fixtureDocument(), { ...fixtureOptions, viewer, world, sessionId: "viewer-observations", markerRadiusMeters: () => 1 });
    if (!loaded.ok) throw new Error("The injected scene fixture was refused.");
    const handle = loaded.handle;
    try {
      await handle.whenSettled();
      expect("immersionDetail" in handle.status).toBe(false);
      const observed: SceneStatus[] = [];
      const off = handle.subscribe(status => { observed.push(status); });
      try {
        const first: SceneViewerImageDetail = { representation: "preview-published", loading: "tiles-in-flight", limitation: "memory", progress: Object.freeze(["resident parent retained"]) };
        publish({ phase: "immersive", active: "garden", target: null, immersionDetail: first });
        expect(handle.status.immersionDetail).toBe(first);
        expect(observed.at(-1)?.immersionDetail).toBe(first);
        const finer: SceneViewerImageDetail = { representation: "tiles-published", loading: null, limitation: null, progress: Object.freeze(["replacement published"]) };
        publish({ phase: "immersive", active: "garden", target: null, immersionDetail: finer });
        expect(handle.status.immersionDetail).toBe(finer);
        expect(observed.at(-1)?.immersionDetail).toBe(finer);
        expect(first.representation).toBe("preview-published");
        publish({ phase: "overview", active: null, target: null, immersionDetail: null });
        expect(handle.status.immersionDetail).toBeNull();
        expect(observed.at(-1)?.immersionDetail).toBeNull();
        publish({ phase: "overview", active: null, target: null });
        expect("immersionDetail" in handle.status).toBe(false);
        expect("immersionDetail" in observed.at(-1)!).toBe(false);
      } finally { off(); }
    } finally { handle.dispose(); }
    expect(listeners.size).toBe(0);
  });
});
