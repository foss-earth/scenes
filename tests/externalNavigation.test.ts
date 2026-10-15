import { describe, expect, it, vi } from "vitest";
import { loadScene, type LoadSceneOptions, type SceneViewerImageInput, type SceneViewerStatus } from "../src/browser.js";
import { validateScene } from "../src/index.js";
import { fixtureDocument, fixtureOptions } from "./fixtures.js";

function document() {
  const value = fixtureDocument();
  value.externalDestinations = [{ id: "other-tour", sceneId: "other-scene", routeId: "other-route" }];
  const entities = value.entities as { links: unknown[] }[];
  entities[0]!.links.push({ id: "external", target: "named-stop", externalDestination: "other-tour", label: "Next tour", direction: { headingDeg: 35, pitchDeg: 2 }, arrivalView: { headingDeg: 9, pitchDeg: -1, verticalFovDeg: 65 } });
  return value;
}
function host() {
  let status: SceneViewerStatus = { phase: "overview", active: null, target: null };
  const inputs: SceneViewerImageInput[] = [];
  const options: LoadSceneOptions = { ...fixtureOptions, sessionId: "external-fixture", markerRadiusMeters: () => 1,
    projectLink: () => ({ x: 4, y: 5 }), world: {
      resolvePlacement: () => ({ state: "pending", placement: { marker: null, radiusMeters: 1, content: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } }),
      showOverview: async () => ({ ok: true, state: "pending" }),
    },
    viewer: { prepare: async input => { inputs.push(input); return { id: input.id, ready: async () => {}, updatePlacement() {}, hover() {}, dispose() {} }; },
      replaceImages() {}, setMapVisibility() {}, enter: async id => { status = { phase: "immersive", active: id, target: null }; return true; }, exit() { status = { phase: "overview", active: null, target: null }; }, status: () => status, subscribe: () => () => {}, pick: () => [], hover() {} } };
  return { options, inputs };
}
describe("declared standalone external navigation", () => {
  it("accepts only a declared external destination and never relaxes dangling local targets", () => {
    expect(validateScene(document(), fixtureOptions).ok).toBe(true);
    const unknown = document(); unknown.externalDestinations = []; expect(validateScene(unknown, fixtureOptions).ok).toBe(false);
    const local = document(); delete local.externalDestinations;
    const links = (local.entities as { links: Record<string, unknown>[] }[])[0]!.links;
    delete links.at(-1)!.externalDestination; expect(validateScene(local, fixtureOptions).ok).toBe(false);
    const duplicate = document(); (duplicate.externalDestinations as unknown[]).push({ id: "other-tour", sceneId: "third" }); expect(validateScene(duplicate, fixtureOptions).ok).toBe(false);
    const address = document(); address.externalDestinations = [{ id: "other-tour", sceneId: "https://unreviewed.example/scene.json" }]; expect(validateScene(address, fixtureOptions).ok).toBe(false);
  });
  it("keeps local-only hosts compatible and marks external actions unavailable", async () => {
    const h = host(), result = await loadScene(document(), h.options); if (!result.ok) throw Error("fixture");
    await result.handle.whenSettled(); await result.handle.enter("garden");
    expect(result.handle.status.entries[0]!.links.at(-1)).toMatchObject({ id: "external", enabled: false });
    expect(await result.handle.follow("external")).toMatchObject({ ok: false, reason: "unavailable" });
    expect(result.handle.hotspots().some(item => item.id === "external")).toBe(false); result.handle.dispose();
  });
  it("delivers authored identity, direction, arrival, route and source through the host port", async () => {
    const h = host(), navigate = vi.fn(async () => ({ ok: true as const })); h.options.externalNavigation = { navigate };
    const result = await loadScene(document(), h.options); if (!result.ok) throw Error("fixture");
    await result.handle.whenSettled(); await result.handle.enter("garden"); expect(await result.handle.follow("external")).toEqual({ ok: true });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ destination: { id: "other-tour", sceneId: "other-scene", routeId: "other-route" }, sphereId: "named-stop", source: { sceneId: "neutral-garden", revision: expect.any(String), sphereId: "garden" }, link: expect.objectContaining({ id: "external", direction: { headingDeg: 35, pitchDeg: 2 }, arrivalView: { headingDeg: 9, pitchDeg: -1, verticalFovDeg: 65 } }), signal: expect.any(AbortSignal) }));
    expect(result.handle.hotspots().some(item => item.id === "external")).toBe(true);
    expect(await h.inputs[0]!.actions.at(-1)!.activate()).toBe(true); result.handle.dispose();
  });
  it("aborts retired navigation but whenSettled waits for the actual host promise", async () => {
    const h = host(); let release!: () => void, signal!: AbortSignal;
    h.options.externalNavigation = { navigate: async input => { signal = input.signal; await new Promise<void>(resolve => { release = resolve; }); return { ok: true }; } };
    const result = await loadScene(document(), h.options); if (!result.ok) throw Error("fixture"); await result.handle.whenSettled(); await result.handle.enter("garden");
    const following = result.handle.follow("external"); result.handle.dispose(); expect(signal.aborted).toBe(true);
    let settled = false; const drain = result.handle.whenSettled().then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
    release(); expect(await following).toMatchObject({ ok: false, reason: "cancelled" }); await drain; expect(settled).toBe(true);
  });
});
