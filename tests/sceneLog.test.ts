// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameLog as createInjectedGameLog, GAME_LOG_FADE_MS } from "@foss-earth/ui/browser";
import type { GameLogEntry } from "@foss-earth/ui";
import { UI_PARAMETERS as FOSS_EARTH_PARAMETERS } from "@foss-earth/ui/settings";
import { createSettingsRegistry } from "@foss-earth/ui/settings";
import type { SceneEntryStatus, SceneFailure, SceneProgress, SceneStatus } from "../src/browser.js";
// Original invalid-manifest cases supply no scene runtime; no implementation is copied.
type SceneRuntime = unknown;
import { createSceneController as createInjectedSceneController, resolveSceneInput, type SceneController, type SceneControllerState } from "../src/browser.js";
import { connectSceneLog } from "../src/browser.js";


// Public owner factories replace former singleton setup; every original assertion remains below.
const createGameLog = (settings: ReturnType<typeof createSettingsRegistry>) => createInjectedGameLog(settings, {
  element: document.createElement("div"), copy: async () => {}, onSize: () => {}, viewportHeight: () => 800, isCentered: () => false,
  timers: { set: (work, ms) => window.setTimeout(work, ms), clear: timer => { if (typeof timer === "number") window.clearTimeout(timer); } },
});
function createSceneController(options: { runtime: SceneRuntime; settings: ReturnType<typeof createSettingsRegistry>; canvas: HTMLElement; examples: []; baseUrl: string; loadOptions?: { onProgress(progress: SceneProgress): void } }): SceneController {
  const controller = createInjectedSceneController({ examples: options.examples, baseUrl: options.baseUrl, canvas: options.canvas, dragThresholdPx: () => 5,
    load: async (input, ports) => {
      const result = await resolveSceneInput(input, { fetch: globalThis.fetch, signal: ports.signal, representations: [], validateImageAsset: () => [],
        onProgress: ports.onProgress,
      });
      if (!result.ok) return result;
      throw new Error("These retained transport cases provide invalid manifests only; a real viewer/world binding is required for valid scenes.");
    },
  });
  // The host observes the controller after it filters superseded transport generations.
  if (options.loadOptions) controller.onProgress(options.loadOptions.onProgress);
  return controller;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fakeLog() {
  const lines: (GameLogEntry & { removed: boolean; updates: number })[] = [];
  return {
    entries: () => lines.filter(line => !line.removed),
    shown: () => lines.filter(line => !line.removed).map(line => [line.tone, line.text]),
    print(entry: GameLogEntry) {
      const line = { ...entry, removed: false, updates: 0 };
      lines.push(line);
      return { update(next: GameLogEntry) { Object.assign(line, { progress: undefined, actions: undefined }, next); line.updates++; }, focusAction() {}, remove() { line.removed = true; } };
    },
  };
}

function fakeController() {
  let state: (state: SceneControllerState) => void = () => {};
  let failure: (failure: SceneFailure) => void = () => {};
  let progress: (progress: SceneProgress) => void = () => {};
  const controller = {
    subscribe(listener: typeof state) { state = listener; listener({ loading: null, errors: [], status: null }); return () => {}; },
    onFailure(listener: typeof failure) { failure = listener; return () => {}; },
    onProgress(listener: typeof progress) { progress = listener; return () => {}; },
  } as unknown as SceneController;
  return {
    controller,
    loading: (url: string | null) => state({ loading: url, errors: [], status: null }),
    show: (status: SceneStatus | null, loading: string | null = null) => state({ loading, errors: [], status }),
    fail: (next: SceneFailure) => failure(next),
    progress: (next: SceneProgress) => progress(next),
  };
}

function status(states: SceneEntryStatus["preview"][]): SceneStatus {
  return {
    phase: "overview", sceneId: "campus", generation: 1, title: "Campus", renderingAvailable: true,
    entries: states.map((preview, i) => ({ id: `p${i}`, title: `Place ${i}`, supported: true, preview })),
  } as SceneStatus;
}

const download: SceneProgress = { id: "p0/preview", kind: "preview", title: "Place 0", receivedBytes: 512, totalBytes: 1024, state: "loading" };

const preview = (id: string, title: string): SceneFailure => ({
  kind: "preview", panorama: { id, title }, cause: "Failed to fetch",
  message: `${title}: its preview could not be loaded: Failed to fetch.`,
});

describe("the scene log", () => {
  it("detaches all subscriptions and unfinished lines despite failures and suppresses held callbacks", () => {
    const source = fakeController(), log = fakeLog(), failures: Error[] = [], stops: ReturnType<typeof vi.fn>[] = [];
    for (const key of ["subscribe", "onProgress", "onFailure"] as const) {
      const register = source.controller[key].bind(source.controller);
      const failure = new Error(key); failures.push(failure); const stop = vi.fn(() => { throw failure; }); stops.push(stop);
      // Existing mock registration keeps callbacks deliberately, as a failed host detach could.
      Object.assign(source.controller, { [key]: (listener: never) => { register(listener); return stop; } });
    }
    const print = log.print.bind(log), releases: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(log, "print").mockImplementation(entry => {
      const line = print(entry), failure = new Error(entry.text), remove = vi.fn(() => { line.remove(); throw failure; });
      failures.push(failure); releases.push(remove); return { ...line, remove };
    });
    const off = connectSceneLog(source.controller, log);
    source.loading("https://host.example/scene.json"); source.show(status(["loading", "idle"]), "https://host.example/scene.json");
    source.progress({ ...download, kind: "image", id: "p0/image" }); source.progress({ ...download, kind: "image", id: "p1/image" });
    let caught: unknown; try { off(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError); expect((caught as AggregateError).errors).toEqual(failures);
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce(); for (const release of releases) expect(release).toHaveBeenCalledOnce(); expect(log.entries()).toHaveLength(0);
    const prints = vi.mocked(log.print).mock.calls.length;
    source.show(status(["ready", "ready"])); source.progress(download); source.fail(preview("p0", "Place 0")); source.loading("https://host.example/late.json"); off();
    expect(log.print).toHaveBeenCalledTimes(prints); for (const release of releases) expect(release).toHaveBeenCalledOnce(); for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
  });
  it("rolls back an earlier subscription and busy line if a later registration throws", () => {
    const log = fakeLog(), stop = vi.fn(), failure = new Error("progress registration refused");
    const controller = { subscribe(listener: (state: SceneControllerState) => void) { listener({ loading: "https://host.example/scene.json", errors: [], status: null }); return stop; }, onProgress() { throw failure; }, onFailure: vi.fn() };
    expect(() => connectSceneLog(controller, log)).toThrow(AggregateError); expect(stop).toHaveBeenCalledOnce(); expect(log.entries()).toHaveLength(0); expect(controller.onFailure).not.toHaveBeenCalled();
  });
  it("reports an unavailable panorama renderer once, without requiring the Scenes tab", () => {
    const log = fakeLog();
    const { controller, show } = fakeController();
    connectSceneLog(controller, log);
    const unavailable = { ...status(["failed"]), renderingAvailable: false, unavailableReason: "Panoramas need WebGPU." };
    show(unavailable);
    show(unavailable);
    expect(log.shown()).toEqual([["error", "Campus: Panoramas need WebGPU."]]);
  });

  it("updates one preview bar as independent downloads arrive, then lets it finish", () => {
    const log = fakeLog();
    const { controller, show, progress } = fakeController();
    connectSceneLog(controller, log);
    show(status(["loading", "idle"]));
    progress(download);
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({ tone: "progress", progress: 0 });
    expect(log.entries()[0].text).toContain("0 of 2 panorama previews ready · 1 loading (512 B / 1.0 KiB)");
    progress({ ...download, receivedBytes: 1024, state: "ready" });
    show(status(["ready", "loading"]));
    expect(log.entries()[0]).toMatchObject({ progress: 0.5 });
    // Refining an already-visible orb does not count as another ready orb.
    progress({ ...download, id: "p0/sharper", receivedBytes: 1024 });
    expect(log.entries()[0]).toMatchObject({ progress: 0.5 });
    show(status(["ready", "ready"]));
    expect(log.entries()[0]).toMatchObject({ tone: "success", progress: 1 });
    const updates = log.entries()[0].updates;
    progress({ ...download, id: "p0/sharper", receivedBytes: 1024, state: "ready" });
    show(status(["ready", "ready"]));
    expect(log.entries()[0].updates).toBe(updates);
    expect(log.entries()).toHaveLength(1);
  });

  it("keeps unknown byte totals indeterminate and removes cancelled image bars", () => {
    const log = fakeLog();
    const { controller, progress } = fakeController();
    const off = connectSceneLog(controller, log);
    const image = { ...download, kind: "image" as const, totalBytes: null };
    progress(image);
    expect(log.entries()[0]).toMatchObject({ tone: "progress", progress: null });
    expect(log.entries()[0].text).toContain("512 B received");
    progress({ ...image, state: "cancelled" });
    expect(log.entries()).toHaveLength(0);
    progress(image);
    off();
    expect(log.entries()).toHaveLength(0);
  });

  it("removes completed images after the configured duration even in open history while other panoramas keep downloading", () => {
    vi.useFakeTimers();
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    settings.set("interface.log.lineDuration", 2);
    const log = createGameLog(settings);
    log.setOpen(true);
    const { controller, show, progress } = fakeController();
    const off = connectSceneLog(controller, log);
    const rows = () => [...log.element.querySelectorAll<HTMLElement>(".game-log__line")];
    const readyRows = () => rows().filter(row => row.dataset.tone === "success");
    const image = { ...download, kind: "image" as const, id: "p0/image" };
    try {
      show(status(["loading", "idle"]));
      progress(image);
      vi.advanceTimersByTime(2000 + GAME_LOG_FADE_MS);
      expect(rows().every(row => !row.hasAttribute("data-expired"))).toBe(true);

      progress({ ...image, receivedBytes: 1024, state: "ready" });
      vi.advanceTimersByTime(1000);
      progress({ ...image, id: "p1/image", title: "Place 1" });
      progress(download);
      vi.advanceTimersByTime(1000);
      expect(readyRows()[0].hasAttribute("data-fading")).toBe(true);
      progress({ ...image, id: "p1/image", title: "Place 1", receivedBytes: 768 });
      progress({ ...download, receivedBytes: 768 });
      vi.advanceTimersByTime(GAME_LOG_FADE_MS);
      expect(readyRows()).toHaveLength(0);
      expect(rows()).toHaveLength(2);

      progress({ ...image, id: "p1/image", title: "Place 1", receivedBytes: 1024, state: "ready" });
      vi.advanceTimersByTime(1000);
      // Repeated completion and camera status events do not renew finished lines.
      progress({ ...image, id: "p1/image", title: "Place 1", receivedBytes: 1024, state: "ready" });
      show(status(["loading", "idle"]));
      vi.advanceTimersByTime(1000 + GAME_LOG_FADE_MS);
      expect(readyRows()).toHaveLength(0);
      expect(rows()).toHaveLength(1);

      show(status(["ready", "ready"]));
      vi.advanceTimersByTime(1000);
      show(status(["ready", "ready"]));
      vi.advanceTimersByTime(1000 + GAME_LOG_FADE_MS);
      // The scene's preview summary remains available in history.
      expect(rows()).toHaveLength(1);
      expect(rows()[0].hasAttribute("data-expired")).toBe(true);
      expect(rows()[0].textContent).toContain("2 of 2 panorama previews ready");
      expect(log.isOpen()).toBe(true);
    } finally {
      off();
      log.destroy();
    }
  });

  it("finishes metadata only once the scene is mounted, with a byte bar while it arrives", () => {
    const log = fakeLog();
    const { controller, loading, show, progress } = fakeController();
    connectSceneLog(controller, log);
    loading("https://example.test/scene.json");
    progress({ ...download, kind: "manifest", title: "https://example.test/scene.json" });
    expect(log.entries()[0]).toMatchObject({ tone: "progress", progress: 0.5 });
    progress({ ...download, kind: "manifest", state: "ready" });
    expect(log.entries()[0].tone).toBe("progress");
    show(status(["idle", "idle"]));
    expect(log.entries()[0]).toMatchObject({ tone: "success", text: "Campus: 2 panorama locations loaded." });
  });

  it("completes with a warning for failed previews and removes unfinished bars on unload", () => {
    const log = fakeLog();
    const { controller, show } = fakeController();
    connectSceneLog(controller, log);
    show(status(["ready", "failed"]));
    expect(log.entries()[0]).toMatchObject({ tone: "warning", progress: 1 });
    expect(log.entries()[0].text).toContain("1 of 2 panorama previews ready; 1 unavailable");
    show({ ...status(["loading", "idle"]), generation: 2 });
    expect(log.entries()).toHaveLength(2);
    show(null);
    expect(log.entries()).toHaveLength(1);
  });

  it("prints each failure as an error, and counts the panoramas whose previews failed on one line", () => {
    const log = fakeLog();
    const { controller, loading, fail } = fakeController();
    connectSceneLog(controller, log);
    fail({ kind: "image", panorama: { id: "mall", title: "Mall" }, cause: "x", message: "Mall: the 6144 px image could not be loaded." });
    fail(preview("mall", "Mall"));
    fail(preview("walter", "Walter"));
    fail(preview("mall", "Mall"));
    expect(log.shown()).toEqual([
      ["error", "Mall: the 6144 px image could not be loaded."],
      ["error", "The previews of 2 panoramas could not be loaded. The latest, Mall: its preview could not be loaded: Failed to fetch."],
    ]);
    // Another scene counts afresh, and the last scene's line stays.
    loading("https://foss-earth.test/other.scene.json");
    loading(null);
    fail(preview("dome", "Dome"));
    expect(log.shown().slice(1)).toEqual([
      ["error", "The previews of 2 panoramas could not be loaded. The latest, Mall: its preview could not be loaded: Failed to fetch."],
      ["error", "Dome: its preview could not be loaded: Failed to fetch."],
    ]);
  });

  it("prints a scene file that could not be fetched, naming its URL once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    const controller = createSceneController({
      runtime: {} as SceneRuntime, settings, canvas: document.createElement("canvas"), examples: [], baseUrl: "https://foss-earth.test/",
    });
    const log = fakeLog();
    const off = connectSceneLog(controller, log);
    expect(await controller.load("tour/scene.json")).toBe(false);
    expect(log.shown()).toEqual([["error", "The scene could not be loaded: https://foss-earth.test/tour/scene.json could not be fetched: Failed to fetch."]]);
    off();
    controller.destroy();
  });

  it("aborts superseded manifests and keeps their late progress out of the current log", async () => {
    const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    const signals = new Map<string, AbortSignal>();
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      signals.set(url.pathname, init.signal!);
      return new Response(new ReadableStream<Uint8Array>({ start(stream) { streams.set(url.pathname, stream); } }));
    }));
    const settings = createSettingsRegistry({ storage: null });
    settings.register(FOSS_EARTH_PARAMETERS);
    const heard: SceneProgress[] = [];
    const controller = createSceneController({
      runtime: {} as SceneRuntime, settings, canvas: document.createElement("canvas"), examples: [], baseUrl: "https://foss-earth.test/",
      loadOptions: { onProgress: progress => heard.push(progress) },
    });
    const log = fakeLog();
    const off = connectSceneLog(controller, log);
    const first = controller.load("first.json");
    const second = controller.load("second.json");
    expect(signals.get("/first.json")!.aborted).toBe(true);
    streams.get("/first.json")!.enqueue(new TextEncoder().encode("{}"));
    streams.get("/first.json")!.close();
    expect(await first).toBe(false);
    expect(heard.filter(progress => progress.title.endsWith("first.json"))).toHaveLength(1);
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0].text).toContain("second.json");
    streams.get("/second.json")!.enqueue(new TextEncoder().encode("{}"));
    streams.get("/second.json")!.close();
    expect(await second).toBe(false);
    expect(log.entries().some(line => line.tone === "progress" || line.tone === "success")).toBe(false);
    expect(log.entries().some(line => line.tone === "error")).toBe(true);
    off();
    controller.destroy();
  });
});
