import { describe, expect, it, vi } from "vitest";
import { createMemorySceneHistory, loadScene, type LoadSceneOptions, type ScenePreparedImage, type SceneViewerImageInput, type SceneViewerStatus, type SceneWorldPorts } from "../src/browser.js";
import { fixtureDocument, fixtureOptions } from "./fixtures.js";
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness() {
  const inputs: SceneViewerImageInput[] = [], images: ScenePreparedImage[] = [], publications: (readonly ScenePreparedImage[])[] = [];
  let status: SceneViewerStatus = { phase: "overview", active: null, target: null };
  const subscribers = new Set<(status: SceneViewerStatus) => void>(), placements = new Map<string, (placement: ReturnType<SceneWorldPorts["resolvePlacement"]>) => void>();
  const viewer = {
    prepare: vi.fn(async (input: SceneViewerImageInput, _signal: AbortSignal) => { inputs.push(input); const image: ScenePreparedImage = { id: input.id, ready: vi.fn(async () => {}), updatePlacement: vi.fn(), hover: vi.fn(), dispose: vi.fn() }; images.push(image); return image; }),
    replaceImages: vi.fn((incoming: readonly ScenePreparedImage[]) => { publications.push(incoming); status = { ...status, active: null, target: null, phase: "overview" }; }),
    setMapVisibility: vi.fn(),
    enter: vi.fn(async (id: string) => { status = { phase: "immersive", active: id, target: null, view: { headingDeg: 10, pitchDeg: 0, verticalFovDeg: 60 } }; for (const listener of subscribers) listener(status); return true; }),
    exit: vi.fn(() => { status = { phase: "overview", active: null, target: null }; for (const listener of subscribers) listener(status); }),
    status: () => status, subscribe: (listener: (status: SceneViewerStatus) => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; }, pick: () => ["garden"], hover: vi.fn(),
  };
  const world: SceneWorldPorts = {
    resolvePlacement: entity => ({ placement: { marker: null, radiusMeters: entity.marker.radiusMeters ?? 1, content: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ...entity.markerStyle }, state: "pending" }),
    watchPlacement: (entity, _options, changed) => { placements.set(entity.id, changed); return () => { placements.delete(entity.id); }; },
    showOverview: vi.fn(async () => ({ ok: true as const, state: "applied" as const })),
  };
  const history = createMemorySceneHistory(), options: LoadSceneOptions = { ...fixtureOptions, viewer, world, markerRadiusMeters: () => 1, sessionId: "host-session", history, projectLink: () => ({ x: 5, y: 10 }) };
  const publishStatus = (next: SceneViewerStatus): void => { status = next; for (const listener of [...subscribers]) listener(status); };
  return { options, viewer, world, history, inputs, images, publications, placements, subscribers, publishStatus };
}
describe("scene references and injected owner lifecycle", () => {
  it("adds live image links to status, hotspots and viewer actions without reloading media", async () => {
    const host = harness(), updateActions = vi.fn();
    host.options.viewer.updateActions = updateActions;
    const document = fixtureDocument();
    (document.entities as { id: string; links: unknown[] }[]).find(e => e.id === "courtyard")!.links = [];
    const result = await loadScene(document, host.options); if (!result.ok) throw new Error("fixture");
    await result.handle.whenSettled();
    const prepared = host.viewer.prepare.mock.calls.length;
    const link = { target: "garden", label: "Return to garden", direction: { headingDeg: 180, pitchDeg: 0 } };
    expect(result.handle.setAdditionalLinks("courtyard", [link])).toBe(true);
    await result.handle.enter("courtyard");
    expect(result.handle.status.entries.find(e => e.id === "courtyard")?.links).toContainEqual(expect.objectContaining({ id: "editor-link-garden", target: "garden", placed: true }));
    expect(result.handle.hotspots()).toContainEqual({ id: "editor-link-garden", label: "Return to garden", x: 5, y: 10 });
    expect(await result.handle.follow("editor-link-garden")).toEqual({ ok: true });
    expect(host.viewer.enter).toHaveBeenLastCalledWith("garden", expect.any(Object));
    expect(updateActions).toHaveBeenCalledWith("courtyard", expect.arrayContaining([expect.objectContaining({ id: "editor-link-garden" })]));
    expect(host.viewer.prepare).toHaveBeenCalledTimes(prepared);
    expect(result.handle.setAdditionalLinks("courtyard", [{ ...link, target: "missing" }])).toBe(false);
    expect(result.handle.setAdditionalLinks("courtyard", [{ ...link, target: "courtyard" }])).toBe(false);
    expect(result.handle.setAdditionalLinks("courtyard", [{ ...link, direction: { headingDeg: NaN, pitchDeg: 0 } }])).toBe(false);
    expect(result.handle.setAdditionalLinks("courtyard", [])).toBe(true);
    expect(result.handle.status.entries.find(e => e.id === "courtyard")?.links.some(l => l.id === "editor-link-garden")).toBe(false);
    const authored = host.inputs[0].actions.length;
    expect(result.handle.setAdditionalLinks("garden", [{ target: "courtyard", label: "Already authored" }])).toBe(true);
    expect(result.handle.status.entries[0].links).toHaveLength(authored);
    result.handle.dispose(); expect(result.handle.setAdditionalLinks("garden", [])).toBe(false);
  });
  it("validates before any owner call, keeps missing ground explicit and publishes ready entries progressively", async () => {
    const host = harness(), invalid = fixtureDocument(); invalid.version = 2;
    expect(await loadScene(invalid, host.options)).toMatchObject({ ok: false }); expect(host.viewer.prepare).not.toHaveBeenCalled();
    const wait = deferred<void>(); host.viewer.prepare.mockImplementationOnce(async input => { host.inputs.push(input); const image: ScenePreparedImage = { id: input.id, ready: () => wait.promise, updatePlacement: vi.fn(), hover: vi.fn(), dispose: vi.fn() }; host.images.push(image); return image; });
    const result = await loadScene(fixtureDocument(), host.options); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(host.publications).toHaveLength(1); expect(host.inputs[0].placement.marker).toBeNull(); expect(result.handle.status.entries[0].preview).toBe("loading");
    wait.resolve(); await result.handle.whenSettled(); expect(result.handle.status.entries.every(entry => entry.preview === "ready")).toBe(true);
    result.handle.dispose(); result.handle.dispose(); expect(host.images.every(image => vi.mocked(image.dispose).mock.calls.length === 1)).toBe(true); expect(host.placements.size).toBe(0); expect(host.subscribers.size).toBe(0);
  });
  it("passes only image/pose/placement/content and scene-resolved actions to360", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    expect(Object.keys(host.inputs[0])).not.toContain("entities"); expect(host.inputs[0].details?.capture?.heightMeters).toBeNull();
    expect(await host.inputs[0].actions[0].activate()).toBe(true); expect(host.viewer.enter).toHaveBeenCalledWith("courtyard", expect.any(Object));
    expect(host.history.entries().at(-1)?.destination).toBe("courtyard"); expect(result.handle.hotspots()).toEqual(expect.any(Array));
    host.history.back(); await result.handle.whenSettled(); expect(host.viewer.exit).toHaveBeenCalledTimes(1); result.handle.dispose();
    expect(await host.inputs[0].actions[0].activate()).toBe(false);
  });
  it("preserves the previous scene on validation or prepublication failure", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    const initial = host.images.slice(), invalid = fixtureDocument(); invalid.version = 2;
    expect(await result.handle.replace(invalid)).toMatchObject({ ok: false }); expect(result.handle.status.sceneId).toBe("neutral-garden"); expect(initial.every(image => vi.mocked(image.dispose).mock.calls.length === 0)).toBe(true);
    host.viewer.replaceImages.mockImplementationOnce(() => { throw new Error("Atomic publication refused"); }); const replacement = fixtureDocument(); replacement.id = "replacement";
    expect(await result.handle.replace(replacement)).toMatchObject({ ok: false }); expect(result.handle.status.sceneId).toBe("neutral-garden"); expect(initial.every(image => vi.mocked(image.dispose).mock.calls.length === 0)).toBe(true); expect(host.images.slice(2).every(image => vi.mocked(image.dispose).mock.calls.length === 1)).toBe(true);
    result.handle.dispose();
  });
  it("disposes stale late preparations and lets a later request win", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    const late = deferred<ScenePreparedImage>(); host.viewer.prepare.mockImplementationOnce(() => late.promise);
    const first = fixtureDocument(); first.id = "stale"; const pending = result.handle.replace(first); await vi.waitFor(() => expect(host.viewer.prepare).toHaveBeenCalledTimes(4));
    const second = fixtureDocument(); second.id = "winner"; expect(await result.handle.replace(second)).toEqual({ ok: true });
    const lateImage = { id: "garden", ready: async () => {}, updatePlacement() {}, hover() {}, dispose: vi.fn() }; late.resolve(lateImage);
    expect(await pending).toMatchObject({ ok: false }); await result.handle.whenSettled(); expect(lateImage.dispose).toHaveBeenCalledTimes(1); expect(result.handle.status.sceneId).toBe("winner"); result.handle.dispose();
  });
  it("isolates preview failure after metadata swap and ignores released placement updates", async () => {
    const host = harness(), failures = vi.fn(); host.options.onFailure = failures;
    host.viewer.prepare.mockImplementationOnce(async input => { const image = { id: input.id, ready: async () => { throw new Error("Preview unavailable"); }, updatePlacement: vi.fn(), hover: vi.fn(), dispose: vi.fn() }; host.images.push(image); return image; });
    const result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    expect(result.handle.status.entries[0].preview).toBe("failed"); expect(failures).toHaveBeenCalledWith(expect.objectContaining({ kind: "preview" }));
    const old = host.placements.get("garden")!, image = host.images[0]; result.handle.dispose(); old({ placement: { marker: [0, 0, 0], radiusMeters: 1, content: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], outline: null, hoverScale: 1 }, state: "placed" }); expect(image.updatePlacement).not.toHaveBeenCalled();
  });
  it("does not publish a cancelled overview when a supplied terrain port returns late success", async () => {
    const host = harness(); host.options.applyOverview = false;
    const document = fixtureDocument(); document.overview = { target: { longitudeDeg: 0, latitudeDeg: 0 }, distanceMeters: 100, headingDeg: 0, pitchDeg: -45, verticalFovDeg: 60 };
    const result = await loadScene(document, host.options); if (!result.ok) throw new Error("fixture");
    await result.handle.whenSettled();
    const late = deferred<{ ok: true; state: "applied" }>(), abort = new AbortController(), failure = vi.fn(); host.options.onFailure = failure;
    const overviewPort = vi.mocked(host.world.showOverview); overviewPort.mockImplementationOnce(() => late.promise);
    const overview = result.handle.showOverview({ signal: abort.signal });
    expect(overviewPort.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(false);
    abort.abort(); expect(result.handle.status.overview).toBe("none"); late.resolve({ ok: true, state: "applied" });
    expect(await overview).toMatchObject({ ok: false, reason: "cancelled" }); expect(result.handle.status.overview).toBe("none"); expect(failure).not.toHaveBeenCalled();
    const calls = overviewPort.mock.calls.length;
    expect(await result.handle.showOverview({ signal: abort.signal })).toMatchObject({ ok: false, reason: "cancelled" }); expect(host.world.showOverview).toHaveBeenCalledTimes(calls);
    result.handle.dispose();
  });
  it("pushes no history when a supplied entry port completes after external cancellation", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    const before = host.history.entries(), late = deferred<boolean>(), abort = new AbortController();
    host.viewer.enter.mockImplementationOnce(() => late.promise);
    const entry = result.handle.enter("garden", { signal: abort.signal }); abort.abort(); late.resolve(true);
    expect(await entry).toMatchObject({ ok: false, reason: "cancelled" }); expect(host.history.entries()).toEqual(before);
    const calls = host.viewer.enter.mock.calls.length;
    expect(await result.handle.enter("garden", { signal: abort.signal })).toMatchObject({ ok: false, reason: "cancelled" }); expect(host.viewer.enter).toHaveBeenCalledTimes(calls);
    result.handle.dispose();
  });
});

describe("actual viewer navigation settlement", () => {
  it("clears a pending overview when the host cancels for fresh input or camera motion", async () => {
    const host = harness(); host.options.applyOverview = false;
    const document = fixtureDocument(); document.overview = { target: { longitudeDeg: 0, latitudeDeg: 0 }, distanceMeters: 100, headingDeg: 0, pitchDeg: -45, verticalFovDeg: 60 };
    const result = await loadScene(document, host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    const failures = vi.fn(); host.options.onFailure = failures;
    vi.mocked(host.world.showOverview).mockResolvedValueOnce({ ok: false, reason: "cancelled", message: "The person moved the camera." });
    expect(await result.handle.showOverview()).toMatchObject({ ok: false, reason: "cancelled" });
    expect(result.handle.status.overview).toBe("none"); expect(failures).not.toHaveBeenCalled(); result.handle.dispose();
  });
  it("keeps immersion and its lease when overview is requested before an exit", async () => {
    const host = harness(); host.options.applyOverview = false;
    const document = fixtureDocument(); document.overview = { target: { longitudeDeg: 0, latitudeDeg: 0 }, distanceMeters: 100, headingDeg: 0, pitchDeg: -45, verticalFovDeg: 60 };
    const result = await loadScene(document, host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    expect(await result.handle.enter("garden")).toEqual({ ok: true });
    const before = host.history.entries();
    expect(await result.handle.showOverview()).toMatchObject({ ok: false, reason: "busy" });
    expect(host.viewer.exit).not.toHaveBeenCalled(); expect(host.world.showOverview).not.toHaveBeenCalled();
    expect(result.handle.status).toMatchObject({ phase: "immersive", active: "garden" }); expect(host.history.entries()).toEqual(before); result.handle.dispose();
  });
  it("waits for the actual exit phase before resolving, pushing history and releasing the observer", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    await result.handle.enter("garden"); const before = host.history.entries();
    host.viewer.exit.mockImplementationOnce(() => host.publishStatus({ phase: "exiting", active: "garden", target: null }));
    let returned = false, settled = false;
    const exit = result.handle.exit().then(value => { returned = true; return value; });
    const cleanup = result.handle.whenSettled().then(() => { settled = true; });
    await Promise.resolve();
    expect(returned).toBe(false); expect(settled).toBe(false); expect(host.history.entries()).toEqual(before); expect(host.subscribers.size).toBe(2);
    host.publishStatus({ phase: "overview", active: null, target: null });
    expect(await exit).toEqual({ ok: true }); await cleanup;
    expect(host.history.entries()).toHaveLength(before.length + 1); expect(host.history.entries().at(-1)?.destination).toBeNull(); expect(host.subscribers.size).toBe(1); result.handle.dispose();
  });
  it("waits for a cancelled preparation to return to overview", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    host.publishStatus({ phase: "preparing", active: null, target: "garden" }); host.viewer.exit.mockImplementationOnce(() => {});
    let returned = false; const exit = result.handle.exit().then(value => { returned = true; return value; }); await Promise.resolve();
    expect(returned).toBe(false); expect(host.viewer.exit).toHaveBeenCalledTimes(1);
    host.publishStatus({ phase: "overview", active: null, target: null }); expect(await exit).toEqual({ ok: true }); expect(host.subscribers.size).toBe(1); result.handle.dispose();
  });
  it("joins repeated exit requests into one native transition and one history publication", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled(); await result.handle.enter("garden");
    const before = host.history.entries(); host.viewer.exit.mockImplementationOnce(() => host.publishStatus({ phase: "exiting", active: "garden", target: null }));
    const first = result.handle.exit(), second = result.handle.exit(); expect(first).toBe(second); expect(host.viewer.exit).toHaveBeenCalledTimes(1); expect(host.subscribers.size).toBe(2);
    host.publishStatus({ phase: "overview", active: null, target: null }); expect(await first).toEqual({ ok: true }); expect(await second).toEqual({ ok: true });
    expect(host.history.entries()).toHaveLength(before.length + 1); expect(host.subscribers.size).toBe(1); result.handle.dispose();
  });
  it("cancels an awaited exit on disposal without writing late history or retaining its subscription", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled(); await result.handle.enter("garden");
    const before = host.history.entries(); host.viewer.exit.mockImplementationOnce(() => host.publishStatus({ phase: "exiting", active: "garden", target: null }));
    const exit = result.handle.exit(); expect(host.subscribers.size).toBe(2); result.handle.dispose();
    expect(await exit).toMatchObject({ ok: false, reason: "cancelled" }); await result.handle.whenSettled();
    expect(host.history.entries()).toEqual(before); expect(host.subscribers.size).toBe(0);
    host.publishStatus({ phase: "overview", active: null, target: null }); expect(host.history.entries()).toEqual(before);
  });
  it("cancels an awaited exit when a new scene replaces its generation", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled(); await result.handle.enter("garden");
    host.viewer.exit.mockImplementationOnce(() => host.publishStatus({ phase: "exiting", active: "garden", target: null })); const exit = result.handle.exit();
    const replacement = fixtureDocument(); replacement.id = "new-generation"; expect(await result.handle.replace(replacement)).toEqual({ ok: true });
    const before = host.history.entries(); expect(await exit).toMatchObject({ ok: false, reason: "cancelled" }); await result.handle.whenSettled();
    expect(host.history.entries()).toEqual(before); expect(result.handle.status.sceneId).toBe("new-generation"); expect(host.subscribers.size).toBe(1); result.handle.dispose();
  });
  it("cancels an awaited exit when another viewer navigation interrupts the outgoing transition", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled(); await result.handle.enter("garden");
    const before = host.history.entries(); host.viewer.exit.mockImplementationOnce(() => host.publishStatus({ phase: "exiting", active: "garden", target: null })); const exit = result.handle.exit();
    host.publishStatus({ phase: "preparing", active: null, target: "courtyard" });
    expect(await exit).toMatchObject({ ok: false, reason: "cancelled" }); expect(host.history.entries()).toEqual(before); expect(host.subscribers.size).toBe(1); result.handle.dispose();
  });
  it("reports native exit failure even after synchronous overview notification and still releases its observer", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled(); await result.handle.enter("garden");
    const before = host.history.entries(), failures = vi.fn(); host.options.onFailure = failures;
    host.viewer.exit.mockImplementationOnce(() => { host.publishStatus({ phase: "overview", active: null, target: null }); throw new Error("Native exit failed after returning the camera."); });
    expect(await result.handle.exit()).toMatchObject({ ok: false, reason: "failed", message: "Native exit failed after returning the camera." });
    expect(host.history.entries()).toEqual(before); expect(host.subscribers.size).toBe(1); expect(failures).toHaveBeenCalledWith(expect.objectContaining({ kind: "navigation" })); result.handle.dispose();
  });
  it("settles cleanup failure honestly after attempting observer release", async () => {
    const host = harness(), result = await loadScene(fixtureDocument(), host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled(); await result.handle.enter("garden");
    const before = host.history.entries(), failures = vi.fn(); host.options.onFailure = failures;
    host.options.viewer = { ...host.viewer, subscribe(listener) { const off = host.viewer.subscribe(listener); return () => { off(); throw new Error("Observer cleanup failed."); }; } };
    expect(await result.handle.exit()).toMatchObject({ ok: false, reason: "failed", message: expect.stringContaining("Observer cleanup failed.") });
    expect(host.history.entries()).toEqual(before); expect(host.subscribers.size).toBe(1); expect(failures).toHaveBeenCalledWith(expect.objectContaining({ kind: "navigation" })); result.handle.dispose();
  });
  it("does not let a stale cancelled overview erase a later applied overview", async () => {
    const host = harness(); host.options.applyOverview = false;
    const document = fixtureDocument(); document.overview = { target: { longitudeDeg: 0, latitudeDeg: 0 }, distanceMeters: 100, headingDeg: 0, pitchDeg: -45, verticalFovDeg: 60 };
    const result = await loadScene(document, host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    const late = deferred<{ ok: false; reason: "cancelled"; message: string }>(); vi.mocked(host.world.showOverview).mockImplementationOnce(() => late.promise);
    const stale = result.handle.showOverview(); expect(await result.handle.showOverview()).toEqual({ ok: true }); expect(result.handle.status.overview).toBe("applied");
    late.resolve({ ok: false, reason: "cancelled", message: "Replaced." }); expect(await stale).toMatchObject({ ok: false, reason: "cancelled" }); expect(result.handle.status.overview).toBe("applied"); result.handle.dispose();
  });
  it("hides orbs for a map layer that starts off and shows them when the layer is turned on", async () => {
    const host = harness();
    const document = fixtureDocument();
    document.layers = [
      { id: "outdoor", title: "Outdoor", layers: [{ id: "outdoor-360", title: "360 images", kind: "panoramas", members: ["garden"] }] },
      { id: "indoor", title: "Indoor", layers: [{ id: "indoor-360", title: "360 images", kind: "panoramas", visible: false, members: ["courtyard"] }] },
    ];
    const result = await loadScene(document, host.options); if (!result.ok) throw new Error("fixture"); await result.handle.whenSettled();
    expect(result.handle.status.layers.map(layer => [layer.id, layer.layers[0]?.id, layer.layers[0]?.visible, layer.layers[0]?.shown])).toEqual([
      ["outdoor", "outdoor-360", true, true], ["indoor", "indoor-360", false, false],
    ]);
    expect(host.viewer.setMapVisibility).toHaveBeenLastCalledWith(["courtyard"]);
    expect(result.handle.setLayerVisible("indoor-360", true)).toBe(true);
    expect(host.viewer.setMapVisibility).toHaveBeenLastCalledWith([]);
    expect(result.handle.setLayerVisible("outdoor", false)).toBe(true);
    expect(host.viewer.setMapVisibility).toHaveBeenLastCalledWith(["garden"]);
    expect(result.handle.status.layers[0].layers[0].enabled).toBe(false);
    expect(result.handle.setLayerVisible("missing", true)).toBe(false);
    expect(result.handle.movePanorama("garden", "indoor-360")).toBe(true);
    expect(result.handle.status.layers[0].layers[0].members).toEqual([]);
    expect(result.handle.status.layers[1].layers[0].members).toEqual(["courtyard", "garden"]);
    expect(host.viewer.setMapVisibility).toHaveBeenLastCalledWith([]);
    expect(result.handle.movePanorama("garden", "missing")).toBe(false);
    result.handle.dispose();
    expect(host.viewer.setMapVisibility).toHaveBeenLastCalledWith([]);
  });
});

it("passes local preview orientation through status and live placement updates", async () => {
  const host = harness();
  const original = host.world.resolvePlacement;
  host.world.resolvePlacement = (entity, options) => ({ ...original(entity, options), previewContent: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
  // The host's resolved preview-sheet owner supplies these sheet coordinates.
  const prepare = host.viewer.prepare.getMockImplementation()!;
  host.viewer.prepare.mockImplementation((input, signal) => {
    Object.assign(input.asset.representations[0]!, { projection: "cube", faceSize: 64, sheet: { url: "https://photos.example/sheet.jpg", x: 0, y: 0, width: 384, height: 64 } });
    return prepare(input, signal);
  });
  const result = await loadScene(fixtureDocument(), host.options);
  if (!result.ok) throw Error("fixture");
  await result.handle.whenSettled();
  expect(result.handle.status.entries[0].previewFace?.content).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  expect(result.handle.status.entries[0].previewFace?.x).toBe(128);
  host.placements.get("garden")!({ placement: host.inputs[0].placement, state: "placed", previewContent: [[0, -1, 0], [1, 0, 0], [0, 0, 1]] });
  expect(result.handle.status.entries[0].previewFace?.content).toEqual([[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
  result.handle.dispose();
});
