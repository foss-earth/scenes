import type { ResolvedPanorama, ValidatedScene } from "./format.js";
import { resolveSceneInput, type SceneInput } from "./manifest.js";
import type { SceneHistoryEntry } from "./history.js";
import type { LoadSceneOptions, LoadSceneResult, SceneActionResult, SceneEntryStatus, SceneHandle, ScenePlacement, ScenePreparedImage, SceneStatus, SceneViewerImageInput, SceneViewerStatus } from "./ports.js";

const failed = (reason: Exclude<SceneActionResult, { ok: true }>["reason"], message: string): SceneActionResult => ({ ok: false, reason, message });
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
interface Entry { record: ResolvedPanorama; input: SceneViewerImageInput; placement: ScenePlacement; prepared: ScenePreparedImage | null; preview: SceneEntryStatus["preview"]; message: string | null; offPlacement: (() => void) | null }
interface Candidate { scene: ValidatedScene; entries: Map<string, Entry>; scope: AbortController }
/** Validates the envelope before asking the supplied viewer or world ports for any image. */
export async function loadScene(input: SceneInput, options: LoadSceneOptions): Promise<LoadSceneResult> {
  const resolved = await resolveSceneInput(input, options);
  if (!resolved.ok) return resolved;
  if (options.signal?.aborted) return { ok: false, errors: [{ path: "$", message: "Loading was cancelled." }] };
  if (!options.sessionId) throw new Error("A host session identity is required for scene history.");
  const handle = createSceneHandle(options);
  const result = await handle.replaceValidated(resolved.scene, options.signal);
  if (!result.ok) { handle.dispose(); return result; }
  return { ok: true, handle };
}

function createSceneHandle(options: LoadSceneOptions): SceneHandle & { replaceValidated(scene: ValidatedScene, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; errors: readonly { path: string; message: string }[] }> } {
  let current: Candidate | null = null, disposed = false, generation = 0, pending: AbortController | null = null;
  let hovered: string | null = null, overview: SceneStatus["overview"] = "none", lastError: string | null = null, overviewRequest = 0;
  let exiting: { published: Candidate | null; promise: Promise<SceneActionResult> } | null = null;
  const listeners = new Set<(status: SceneStatus) => void>(), work = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T> => { work.add(promise); void promise.finally(() => work.delete(promise)).catch(() => {}); return promise; };
  const emit = (): void => { if (current) for (const listener of [...listeners]) { try { listener(snapshot()); } catch { /* A host observer does not own scene cleanup. */ } } };
  const report = (entry: Entry | null, kind: "preview" | "navigation", error: unknown): void => {
    const cause = messageOf(error);
    try { options.onFailure?.({ kind, panorama: entry ? { id: entry.record.id, title: entry.record.title } : null, cause, message: `${entry ? `The panorama ${entry.record.title}` : "The scene"} could not ${kind === "preview" ? "load its preview" : "navigate"}: ${cause}.` }); } catch { /* Reporting must not stop resource cleanup. */ }
  };
  const release = (candidate: Candidate): void => {
    candidate.scope.abort(new Error("The scene generation was released."));
    for (const entry of candidate.entries.values()) {
      try { entry.offPlacement?.(); } catch (error) { report(entry, "navigation", error); }
      entry.offPlacement = null;
      try { entry.prepared?.dispose(); } catch (error) { report(entry, "preview", error); }
      entry.prepared = null;
    }
  };
  function snapshot(): SceneStatus {
    const scene = current?.scene, viewer = options.viewer.status();
    const entries: SceneEntryStatus[] = (scene?.entityOrder ?? []).map(id => {
      const entry = current?.entries.get(id);
      if (!entry) return { id, title: id, description: null, supported: false, message: scene?.unsupported.get(id)?.reason ?? "This entity is unavailable.", placement: "unavailable", preview: "idle", marker: null, capture: null, pose: null, attribution: null, previewDetail: null, images: [], links: [] };
      const { record, input } = entry, observations = options.describeImage?.(id);
      return {
        id, title: record.title, description: record.description ?? null, supported: true, message: entry.message ?? entry.placement.message ?? null,
        placement: entry.placement.state, preview: entry.preview,
        marker: { ...record.marker, radiusMeters: input.placement.radiusMeters, authoredRadius: record.marker.radiusMeters !== undefined },
        capture: input.details?.capture ?? null, pose: { ...record.imagePose, aligned: record.imagePose.aligned ?? null }, attribution: input.credits,
        previewDetail: observations?.previewDetail ?? null, images: observations?.images ?? [],
        links: record.links.map(link => ({ id: link.id, label: link.label, target: link.target, enabled: Boolean(scene?.panoramas.has(link.target)), placed: Boolean(link.direction) })),
      };
    });
    return { ...viewer, phase: disposed ? "disposed" : viewer.phase, sceneId: scene?.id ?? "", revision: scene?.revision ?? "", title: scene?.title ?? "", generation, hovered, entries, groups: scene?.groups ?? [], credits: viewer.credits ?? (viewer.active && current?.entries.get(viewer.active) ? [{ ...current.entries.get(viewer.active)!.input.credits, assetId: current.entries.get(viewer.active)!.input.asset.id }] : []), overview, warnings: scene?.warnings ?? [], renderingAvailable: viewer.renderingAvailable ?? true, unavailableReason: viewer.unavailableReason ?? null, lastError: lastError ?? viewer.lastError ?? null, view: viewer.view ?? null };
  }
  async function prepare(scene: ValidatedScene, request: AbortController, signal?: AbortSignal): Promise<Candidate> {
    const scope = new AbortController(), candidate: Candidate = { scene, entries: new Map(), scope };
    const combined = signal ? AbortSignal.any([request.signal, signal, scope.signal]) : AbortSignal.any([request.signal, scope.signal]);
    try {
      for (const entity of scene.panoramas.values()) {
        const radiusMeters = entity.marker.radiusMeters ?? options.markerRadiusMeters();
        if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) throw new Error("The host orb radius must be positive metres.");
        const placement = options.world.resolvePlacement(entity, { radiusMeters });
        const asset = scene.assets.get(entity.assetId)!;
        const input: SceneViewerImageInput = {
          id: entity.id, asset, pose: entity.imagePose, placement: placement.placement, title: entity.title,
          ...(entity.description ? { description: entity.description } : {}), credits: asset.attribution,
          ...(entity.initialView ? { initialView: entity.initialView } : {}),
          actions: entity.links.map(link => ({ id: link.id, label: link.label, ...(link.direction ? { direction: link.direction } : {}), activate: async () => {
            if (disposed || current !== candidate || !scene.panoramas.has(link.target)) return false;
            return (await enter(link.target, { ...(link.arrivalView ? { view: link.arrivalView } : {}) })).ok;
          } })),
          details: { capture: { latitudeDeg: entity.capture.latitudeDeg, longitudeDeg: entity.capture.longitudeDeg, heightMeters: entity.capture.height?.meters ?? null, horizontalAccuracyMeters: entity.capture.horizontalAccuracyMeters ?? null }, groups: scene.groups.filter(group => group.members.includes(entity.id)).map(group => group.title) },
        };
        candidate.entries.set(entity.id, { record: entity, input, placement, prepared: null, preview: "loading", message: null, offPlacement: null });
      }
      // Metadata preparation is concurrent; the viewer's ready() performs progressive media readiness.
      await Promise.all([...candidate.entries.values()].map(entry => track((async () => {
        const image = await options.viewer.prepare(entry.input, combined);
        if (combined.aborted || disposed) { image.dispose(); return; }
        if (image.id !== entry.record.id) { image.dispose(); throw new Error("The viewer prepared a different placed-image identity."); }
        entry.prepared = image;
      })())));
      if (combined.aborted || disposed) throw combined.reason ?? new Error("Loading was cancelled.");
      return candidate;
    } catch (error) { release(candidate); throw error; }
  }
  const beginReplacement = (): { token: number; request: AbortController } => {
    const token = ++generation;
    pending?.abort(new Error("A later scene replaced this request."));
    const request = new AbortController(); pending = request;
    return { token, request };
  };
  async function replaceValidated(scene: ValidatedScene, signal?: AbortSignal, context?: { token: number; request: AbortController }): Promise<{ ok: true } | { ok: false; errors: readonly { path: string; message: string }[] }> {
    if (disposed) return { ok: false, errors: [{ path: "$", message: "The scene is disposed." }] };
    const { token, request } = context ?? beginReplacement();
    let candidate: Candidate | null = null;
    try {
      candidate = await track(prepare(scene, request, signal));
      if (disposed || token !== generation || signal?.aborted || request.signal.aborted) { release(candidate); return { ok: false, errors: [{ path: "$", message: "Loading was cancelled." }] }; }
      const outgoing = current;
      current = candidate;
      try { options.viewer.replaceImages([...candidate.entries.values()].flatMap(entry => entry.prepared ? [entry.prepared] : [])); }
      catch (error) { current = outgoing; throw error; }
      candidate = null; hovered = null; lastError = null; overview = scene.overview ? "pending" : "none";
      if (outgoing) release(outgoing);
      const published = current;
      for (const entry of published.entries.values()) {
        try {
          if (options.world.watchPlacement) entry.offPlacement = options.world.watchPlacement(entry.record, { radiusMeters: entry.input.placement.radiusMeters }, next => {
            if (disposed || current !== published) return;
            entry.placement = next; entry.input = { ...entry.input, placement: next.placement }; entry.prepared?.updatePlacement(next.placement); emit();
          });
        } catch (error) { entry.message = messageOf(error); report(entry, "navigation", error); }
        const image = entry.prepared!;
        void track(Promise.resolve().then(() => image.ready()).then(() => { if (!disposed && current === published) { entry.preview = "ready"; emit(); } }, error => {
          if (disposed || current !== published || published.scope.signal.aborted) return;
          entry.preview = "failed"; entry.message = messageOf(error); report(entry, "preview", error); emit();
        }));
      }
      try { options.history?.record(historyEntry(null), "replace"); } catch (error) { report(null, "navigation", error); }
      emit();
      if (options.applyOverview !== false && scene.overview) void track(showOverview({ signal: published.scope.signal }));
      return { ok: true };
    } catch (error) {
      if (candidate) release(candidate);
      return { ok: false, errors: [{ path: "$", message: request.signal.aborted || signal?.aborted || disposed ? "Loading was cancelled." : `The new scene could not be prepared: ${messageOf(error)}` }] };
    } finally { if (pending === request) pending = null; }
  }
  const historyEntry = (destination: string | null): SceneHistoryEntry => ({ v: 1, session: options.sessionId, sceneId: current!.scene.id, revision: current!.scene.revision, destination, view: destination ? options.viewer.status().view ?? null : null });
  async function enter(id: string, enterOptions: { signal?: AbortSignal; view?: SceneViewerImageInput["initialView"] } = {}, historyMode: "push" | "replace" | null = "push"): Promise<SceneActionResult> {
    if (disposed) return failed("disposed", "The scene is disposed.");
    if (!current?.entries.has(id)) return failed("unavailable", `Panorama "${id}" is not supported in this scene.`);
    const published = current, entry = published.entries.get(id)!;
    const signal = enterOptions.signal ? AbortSignal.any([enterOptions.signal, published.scope.signal]) : published.scope.signal;
    if (signal.aborted) return failed("cancelled", "Entering was cancelled.");
    try {
      const success = await options.viewer.enter(id, { ...enterOptions, signal });
      if (signal.aborted) return failed("cancelled", "Entering was cancelled.");
      const result = success ? { ok: true as const } : failed(enterOptions.signal?.aborted || published.scope.signal.aborted ? "cancelled" : "unavailable", "The viewer could not enter this panorama.");
      if (disposed || current !== published) return failed("cancelled", "The scene changed while entering.");
      if (result.ok && historyMode) options.history?.record(historyEntry(id), historyMode);
      if (!result.ok && result.reason !== "cancelled") lastError = result.message;
      emit(); return result;
    } catch (error) { if (!signal.aborted) { lastError = messageOf(error); report(entry, "navigation", error); emit(); } return failed(signal.aborted ? "cancelled" : "failed", messageOf(error)); }
  }
  /** The viewer owns the exit animation; its existing subscription proves when
   * navigation has returned. Scene replacement/disposal cancels this observer. */
  function awaitViewerExit(published: Candidate | null): Promise<SceneActionResult> {
    return new Promise(resolve => {
      const signal = published?.scope.signal;
      let off: (() => void) | null = null, installing = true, callingExit = false, started = false, settled = false;
      let outcome: SceneActionResult | null = null;
      const initialPhase = options.viewer.status().phase;
      let cancellingPreparation = initialPhase === "preparing" || initialPhase === "entering";
      const finish = (result: SceneActionResult): void => {
        if (settled) return;
        outcome = result;
        // A synchronous subscriber/native exit may complete while returning
        // its cleanup. Acquire that cleanup before settling the caller.
        if (installing || callingExit) return;
        settled = true;
        const errors: unknown[] = [];
        try { signal?.removeEventListener("abort", onAbort); } catch (error) { errors.push(error); }
        try { off?.(); } catch (error) { errors.push(error); }
        off = null;
        resolve(errors.length ? failed("failed", `The exit observer could not be released: ${errors.map(messageOf).join("; ")}`) : result);
      };
      const onAbort = (): void => finish(failed("cancelled", "The scene changed while leaving."));
      const observe = (status: SceneViewerStatus): void => {
        if (!started || settled) return;
        if (disposed || current !== published || signal?.aborted || status.phase === "disposed") onAbort();
        else if (status.phase === "overview" && status.active === null && status.target === null) finish({ ok: true });
        else if (status.phase === "exiting") cancellingPreparation = false;
        else if ((!cancellingPreparation && (status.phase === "preparing" || status.phase === "entering")) || (cancellingPreparation && status.phase === "immersive")) finish(failed("cancelled", "Another navigation replaced the exit."));
      };
      try {
        signal?.addEventListener("abort", onAbort, { once: true });
        off = options.viewer.subscribe(observe);
        installing = false;
        if (disposed || current !== published || signal?.aborted) { onAbort(); return; }
        started = true; callingExit = true;
        try { options.viewer.exit(); }
        finally { callingExit = false; }
        observe(options.viewer.status());
        if (outcome && !settled) finish(outcome);
      } catch (error) {
        installing = false; callingExit = false;
        finish(failed("failed", messageOf(error)));
      }
    });
  }
  async function leaveViewer(published: Candidate | null, historyMode: "push" | "replace" | null): Promise<SceneActionResult> {
    try {
      const result = await awaitViewerExit(published);
      if (!result.ok) { if (result.reason === "failed") { lastError = result.message; report(null, "navigation", result.message); emit(); } return result; }
      if (disposed || current !== published || options.viewer.status().phase !== "overview") return failed("cancelled", "The scene changed while leaving.");
      if (current && historyMode) options.history?.record(historyEntry(null), historyMode);
      emit(); return { ok: true };
    }
    catch (error) { lastError = messageOf(error); report(null, "navigation", error); emit(); return failed("failed", lastError); }
  }
  function exit(historyMode: "push" | "replace" | null = "push"): Promise<SceneActionResult> {
    if (disposed) return Promise.resolve(failed("disposed", "The scene is disposed."));
    const published = current;
    if (exiting?.published === published) return exiting.promise;
    let resolve!: (result: SceneActionResult) => void;
    const request = { published, promise: new Promise<SceneActionResult>(done => { resolve = done; }) };
    exiting = request;
    // Record the joinable operation before calling the viewer, which may
    // synchronously notify a host that asks to exit again.
    void leaveViewer(published, historyMode).then(result => {
      if (exiting === request) exiting = null;
      resolve(result);
    }, error => {
      if (exiting === request) exiting = null;
      lastError = messageOf(error); report(null, "navigation", error); emit(); resolve(failed("failed", lastError));
    });
    return request.promise;
  }
  async function showOverview(overviewOptions: { signal?: AbortSignal } = {}): Promise<SceneActionResult> {
    if (disposed) return failed("disposed", "The scene is disposed.");
    const published = current;
    if (!published?.scene.overview) return failed("unavailable", "The scene does not define an overview.");
    const viewer = options.viewer.status();
    if (viewer.active !== null || viewer.phase === "immersive" || viewer.phase === "exiting") return failed("busy", "Exit the panorama first.");
    const request = ++overviewRequest;
    const signal = overviewOptions.signal ? AbortSignal.any([overviewOptions.signal, published.scope.signal]) : published.scope.signal;
    const cancelled = (): SceneActionResult => {
      if (!disposed && current === published && request === overviewRequest && overview === "pending") { overview = "none"; emit(); }
      return failed("cancelled", "Placing the overview was cancelled.");
    };
    if (signal.aborted) return cancelled();
    const onAbort = (): void => { cancelled(); };
    try {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) return cancelled();
      const result = await options.world.showOverview(published.scene.overview, { signal });
      if (signal.aborted) return cancelled();
      if (disposed || current !== published || request !== overviewRequest) return failed("cancelled", "The scene changed while placing the overview.");
      if (!result.ok && result.reason === "cancelled") return cancelled();
      if (result.ok) overview = result.state; else lastError = result.message;
      emit(); return result.ok ? { ok: true } : result;
    } catch (error) { if (signal.aborted) return cancelled(); if (disposed || current !== published || request !== overviewRequest) return failed("cancelled", "The scene changed while placing the overview."); lastError = messageOf(error); report(null, "navigation", error); emit(); return failed("failed", messageOf(error)); }
    finally { signal.removeEventListener("abort", onAbort); }
  }
  const offViewer = options.viewer.subscribe(() => emit());
  const offHistory = options.history?.subscribe(entry => {
    if (!current || disposed) return;
    if (!entry || entry.session !== options.sessionId || entry.sceneId !== current.scene.id) { void track(exit(null)); return; }
    if (entry.revision !== current.scene.revision) { lastError = "The history entry names a different scene revision."; void track(exit(null)); emit(); return; }
    if (entry.destination === null) { void track(exit(null)); return; }
    if (!current.entries.has(entry.destination)) { lastError = `The history destination "${entry.destination}" is not available.`; emit(); return; }
    void track(enter(entry.destination, entry.view ? { view: entry.view } : {}, "replace"));
  });
  return {
    get status() { return snapshot(); }, get disposed() { return disposed; }, replaceValidated,
    enter, exit: () => track(exit()), showOverview,
    async follow(id, followOptions = {}) { const active = options.viewer.status().active; const link = active ? current?.entries.get(active)?.record.links.find(item => item.id === id) : undefined; return link ? enter(link.target, { ...followOptions, ...(link.arrivalView ? { view: link.arrivalView } : {}) }) : failed("unavailable", `Link "${id}" is not available from the current panorama.`); },
    async replace(input, replaceOptions = {}) {
      if (disposed) return { ok: false, errors: [{ path: "$", message: "The scene is disposed." }] };
      const context = beginReplacement();
      const signal = replaceOptions.signal ? AbortSignal.any([context.request.signal, replaceOptions.signal]) : context.request.signal;
      try {
        const resolved = await track(resolveSceneInput(input, { ...options, ...replaceOptions, signal, baseUrl: replaceOptions.baseUrl ?? options.baseUrl }));
        if (signal.aborted || disposed || context.token !== generation) return { ok: false, errors: [{ path: "$", message: "Loading was cancelled." }] };
        return resolved.ok ? await replaceValidated(resolved.scene, signal, context) : resolved;
      } finally { if (pending === context.request) pending = null; }
    },
    pick: (x, y) => disposed || options.viewer.status().phase !== "overview" ? [] : options.viewer.pick(x, y).filter(id => current?.entries.has(id)),
    hover(id) {
      const next = !disposed && options.viewer.status().phase === "overview" && id && current?.entries.has(id) ? id : null;
      if (next === hovered) return;
      options.viewer.hover(next); hovered = next; emit();
    },
    hotspots() {
      const active = options.viewer.status().active;
      const links = !disposed && options.viewer.status().phase === "immersive" && active ? current?.entries.get(active)?.record.links ?? [] : [];
      return links.flatMap(link => { const point = link.direction && options.projectLink?.(link.direction); return point && current?.entries.has(link.target) ? [{ id: link.id, label: link.label, ...point }] : []; });
    },
    subscribe(listener) { if (!disposed) { listeners.add(listener); if (current) listener(snapshot()); } return () => { listeners.delete(listener); }; },
    onFrame(listener) { return disposed ? () => {} : options.frames?.subscribe(listener) ?? (() => {}); },
    async whenSettled() { while (work.size) await Promise.allSettled([...work]); },
    dispose() {
      if (disposed) return; disposed = true; generation += 1; pending?.abort(new Error("The scene was disposed.")); pending = null;
      try { offHistory?.(); } catch (error) { report(null, "navigation", error); }
      try { offViewer(); } catch (error) { report(null, "navigation", error); }
      if (current) { try { options.viewer.replaceImages([]); } catch (error) { report(null, "navigation", error); } finally { release(current); } }
      emit(); current = null; listeners.clear();
    },
  };
}
