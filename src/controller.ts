import type { SceneDiagnostic } from "./format.js";
import { sceneManifestUrl, type SceneProgress } from "./manifest.js";
import type { LoadSceneResult, SceneFailure, SceneHandle, SceneStatus } from "./ports.js";
export interface SceneExample { id: string; title: string; description: string; url: string }
export interface SceneControllerState { loading: string | null; errors: readonly SceneDiagnostic[]; status: SceneStatus | null }
export interface SceneController {
  readonly examples: readonly SceneExample[];
  state(): SceneControllerState; handle(): SceneHandle | null;
  load(input: string, options?: { exampleId?: boolean }): Promise<boolean>;
  unload(): void;
  /**
   * Drops a press recorded on pointerdown so the matching pointerup does not enter a
   * panorama. Pointerup does not look at defaultPrevented; a gesture that consumed the
   * press, such as a long-press, has to call this before release. Unknown ids are ignored.
   */
  consumePointerPress(pointerId: number): void;
  subscribe(listener: (state: SceneControllerState) => void): () => void;
  onFailure(listener: (failure: SceneFailure) => void): () => void;
  onProgress(listener: (progress: SceneProgress) => void): () => void;
  whenSettled(): Promise<void>;
  destroy(): void;
}
export interface SceneControllerOptions {
  /** Supplied application catalogue; no built-in example/host identity is imported. */
  examples: readonly SceneExample[]; baseUrl: string;
  load(input: string, options: { signal: AbortSignal; onFailure(failure: SceneFailure): void; onProgress(progress: SceneProgress): void }): Promise<LoadSceneResult>;
  signal?: AbortSignal;
  canvas?: HTMLElement;
  /** Existing input setting in CSS pixels; only needed when a canvas is provided. */
  dragThresholdPx?(): number;
}
/** Registered shareable IDs resolve through examples only, never arbitrary address-bar URLs. */
export function createSceneController(options: SceneControllerOptions): SceneController {
  const examples = options.examples.map(entry => ({ ...entry })), ids = new Set<string>();
  for (const entry of examples) { if (!entry.id || ids.has(entry.id)) throw new Error("Scene examples require unique stable IDs."); ids.add(entry.id); sceneManifestUrl(entry.url, options.baseUrl); }
  if (options.canvas && !options.dragThresholdPx) throw new Error("Canvas activation requires the host's drag threshold setting.");
  let current: SceneHandle | null = null, offStatus: (() => void) | null = null, state: SceneControllerState = { loading: null, errors: [], status: null };
  let pending: AbortController | null = null, loadCounter = 0, destroyed = false, progressOwner: object | null = null;
  const listeners = new Set<(state: SceneControllerState) => void>(), failureListeners = new Set<(failure: SceneFailure) => void>(), progressListeners = new Set<(progress: SceneProgress) => void>(), work = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T> => { work.add(promise); void promise.finally(() => work.delete(promise)).catch(() => {}); return promise; };
  const set = (next: Partial<SceneControllerState>): void => { state = { ...state, ...next }; for (const listener of [...listeners]) { try { listener(state); } catch { /* Isolate host observers. */ } } };
  const fail = (failure: SceneFailure): void => { if (!destroyed) for (const listener of [...failureListeners]) { try { listener(failure); } catch { /* Isolate host observers. */ } } };
  const progress = (next: SceneProgress, owner: object): void => { if (destroyed || owner !== progressOwner || next.kind === "manifest" && next.id !== state.loading) return; for (const listener of [...progressListeners]) { try { listener(next); } catch { /* Isolate host observers. */ } } };
  const failScene = (url: string, errors: readonly SceneDiagnostic[]): void => {
    if (!errors.length) return;
    const first = errors[0], cause = first.path === "$" ? first.message : `${first.path}: ${first.message}`;
    fail({ kind: "scene", sphere: null, cause, message: `${cause.includes(url) ? "The scene" : `The scene ${url}`} could not be loaded: ${/[.!?]$/.test(cause) ? cause : `${cause}.`}${errors.length > 1 ? ` Scenes → Content lists ${errors.length - 1} more.` : ""}` });
  };
  async function load(input: string, loadOptions: { exampleId?: boolean } = {}): Promise<boolean> {
    if (destroyed || options.signal?.aborted) return false;
    let url: string;
    try {
      const example = loadOptions.exampleId ? examples.find(entry => entry.id === input.trim()) : undefined;
      if (loadOptions.exampleId && !example) throw new Error(`There is no example scene "${input}".`);
      url = sceneManifestUrl(example?.url ?? input.trim(), options.baseUrl).href;
    } catch (error) { const errors = [{ path: "$", message: error instanceof Error ? error.message : String(error) }]; set({ errors }); failScene(input, errors); return false; }
    const token = ++loadCounter;
    pending?.abort(new Error("A later scene load superseded this request."));
    const request = new AbortController(); pending = request;
    const signal = options.signal ? AbortSignal.any([request.signal, options.signal]) : request.signal;
    set({ loading: url, errors: [] });
    try {
      if (current) {
        const result = await track(current.replace(url, { signal }));
        if (destroyed || token !== loadCounter || signal.aborted) return false;
        set({ loading: null, errors: result.ok ? [] : result.errors });
        if (!result.ok) failScene(url, result.errors);
        return result.ok;
      }
      const owner = {}; progressOwner = owner;
      const result = await track(options.load(url, { signal, onFailure: failure => { if (progressOwner === owner) fail(failure); }, onProgress: next => progress(next, owner) }));
      if (destroyed || token !== loadCounter || signal.aborted) { if (result.ok) { result.handle.dispose(); await result.handle.whenSettled(); } return false; }
      if (!result.ok) { set({ loading: null, errors: result.errors }); failScene(url, result.errors); return false; }
      current = result.handle; offStatus = current.subscribe(status => set({ status })); set({ loading: null, errors: [], status: current.status }); return true;
    } catch (error) {
      if (destroyed || token !== loadCounter || signal.aborted) return false;
      const errors = [{ path: "$", message: error instanceof Error ? error.message : String(error) }]; set({ loading: null, errors }); failScene(url, errors); return false;
    } finally { if (pending === request) pending = null; }
  }
  const presses = new Map<number, { x: number; y: number; moved: boolean }>();
  let multiTouch = false, pointerCursor = false;
  const canvas = options.canvas, originalCursor = canvas?.style.cursor ?? "";
  const setHover = (id: string | null): void => { current?.hover(id); if (canvas && (id || pointerCursor)) canvas.style.cursor = id ? "pointer" : originalCursor; pointerCursor = id !== null; };
  function unload(): void {
    loadCounter += 1; progressOwner = null; pending?.abort(new Error("The scene was unloaded.")); pending = null;
    presses.clear(); multiTouch = false; setHover(null); offStatus?.(); offStatus = null;
    const old = current; current = null; if (old) { old.dispose(); void track(old.whenSettled()); }
    set({ loading: null, errors: [], status: null });
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0 || current && current.status.phase !== "overview") return;
    presses.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false }); if (presses.size > 1) multiTouch = true;
  };
  const onPointerMove = (event: PointerEvent): void => {
    const press = presses.get(event.pointerId), threshold = options.dragThresholdPx?.();
    if (press && (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || Math.hypot(event.clientX - press.x, event.clientY - press.y) >= threshold)) press.moved = true;
    if (event.pointerType !== "touch" && event.buttons === 0) setHover(current?.pick(event.clientX, event.clientY)[0] ?? null);
  };
  const onPointerUp = (event: PointerEvent): void => {
    const press = presses.get(event.pointerId); presses.delete(event.pointerId); const wasMulti = multiTouch; if (!presses.size) multiTouch = false;
    if (!press || press.moved || wasMulti || !current || current.status.phase !== "overview") return;
    const [id] = current.pick(event.clientX, event.clientY); if (id) void track(current.enter(id));
  };
  const onPointerCancel = (event: PointerEvent): void => { presses.delete(event.pointerId); multiTouch = presses.size > 0 && multiTouch; };
  const onPointerLeave = (event: PointerEvent): void => { if (event.pointerType !== "touch") setHover(null); };
  canvas?.addEventListener("pointerdown", onPointerDown); canvas?.addEventListener("pointermove", onPointerMove); canvas?.addEventListener("pointerup", onPointerUp); canvas?.addEventListener("pointercancel", onPointerCancel); canvas?.addEventListener("pointerleave", onPointerLeave);
  const onAbort = (): void => unload(); options.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    examples, state: () => state, handle: () => current, load, unload,
    consumePointerPress(pointerId) { presses.delete(pointerId); if (!presses.size) multiTouch = false; },
    subscribe(listener) { if (!destroyed) { listeners.add(listener); listener(state); } return () => { listeners.delete(listener); }; },
    onFailure(listener) { if (!destroyed) failureListeners.add(listener); return () => { failureListeners.delete(listener); }; },
    onProgress(listener) { if (!destroyed) progressListeners.add(listener); return () => { progressListeners.delete(listener); }; },
    async whenSettled() { while (work.size) await Promise.allSettled([...work]); if (current) await current.whenSettled(); },
    destroy() {
      if (destroyed) return; destroyed = true;
      canvas?.removeEventListener("pointerdown", onPointerDown); canvas?.removeEventListener("pointermove", onPointerMove); canvas?.removeEventListener("pointerup", onPointerUp); canvas?.removeEventListener("pointercancel", onPointerCancel); canvas?.removeEventListener("pointerleave", onPointerLeave);
      options.signal?.removeEventListener("abort", onAbort); unload(); listeners.clear(); failureListeners.clear(); progressListeners.clear();
    },
  };
}
