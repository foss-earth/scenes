import { isRecord } from "@foss-earth/images";
import type { ViewRecord } from "./format.js";
export const SCENE_HISTORY_KEY = "fossEarthScene";
export interface SceneHistoryEntry { v: 1; session: string; sceneId: string; revision: string; destination: string | null; view: ViewRecord | null }
export interface SceneHistoryAdapter {
  record(entry: SceneHistoryEntry, mode: "push" | "replace"): void;
  subscribe(listener: (entry: SceneHistoryEntry | null) => void): () => void;
}
export function isSceneHistoryEntry(value: unknown): value is SceneHistoryEntry {
  if (!isRecord(value) || value.v !== 1 || ![value.session, value.sceneId, value.revision].every(item => typeof item === "string" && item.length > 0) || !(value.destination === null || typeof value.destination === "string" && value.destination.length > 0)) return false;
  if (Object.keys(value).some(key => !["v", "session", "sceneId", "revision", "destination", "view"].includes(key))) return false;
  if (value.view === null) return true;
  return isRecord(value.view) && Object.keys(value.view).every(key => ["headingDeg", "pitchDeg", "verticalFovDeg"].includes(key)) &&
    typeof value.view.headingDeg === "number" && Number.isFinite(value.view.headingDeg) && value.view.headingDeg >= 0 && value.view.headingDeg < 360 &&
    typeof value.view.pitchDeg === "number" && Number.isFinite(value.view.pitchDeg) && value.view.pitchDeg >= -90 && value.view.pitchDeg <= 90 &&
    typeof value.view.verticalFovDeg === "number" && Number.isFinite(value.view.verticalFovDeg) && value.view.verticalFovDeg > 0 && value.view.verticalFovDeg < 180;
}
const copy = (entry: SceneHistoryEntry): SceneHistoryEntry => ({ ...entry, view: entry.view ? { ...entry.view } : null });
function checked(entry: SceneHistoryEntry): SceneHistoryEntry {
  if (!isSceneHistoryEntry(entry)) throw new Error("History accepts only version-one scene identity, destination and finite view records.");
  return copy(entry);
}
/** Explicit target only, merged into the host state without changing its URL. */
export function createBrowserSceneHistory(target: Pick<Window, "history" | "addEventListener" | "removeEventListener">): SceneHistoryAdapter {
  return {
    record(entry, mode) {
      const current = target.history.state;
      const state = { ...(isRecord(current) ? current : {}), [SCENE_HISTORY_KEY]: checked(entry) };
      if (mode === "push") target.history.pushState(state, ""); else target.history.replaceState(state, "");
    },
    subscribe(listener) {
      const onPopState = (event: Event): void => {
        const state: unknown = (event as PopStateEvent).state;
        const value = isRecord(state) ? state[SCENE_HISTORY_KEY] : null;
        listener(isSceneHistoryEntry(value) ? copy(value) : null);
      };
      target.addEventListener("popstate", onPopState);
      return () => target.removeEventListener("popstate", onPopState);
    },
  };
}
export function createMemorySceneHistory(): SceneHistoryAdapter & { back(): void; forward(): void; entries(): readonly SceneHistoryEntry[] } {
  const stack: SceneHistoryEntry[] = [], listeners = new Set<(entry: SceneHistoryEntry | null) => void>();
  let index = -1;
  const emit = (): void => { for (const listener of [...listeners]) listener(stack[index] ? copy(stack[index]) : null); };
  return {
    record(entry, mode) {
      const value = checked(entry);
      if (mode === "replace" && index >= 0) stack[index] = value;
      else { stack.splice(index + 1); stack.push(value); index = stack.length - 1; }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    back() { if (index > 0) { index -= 1; emit(); } },
    forward() { if (index < stack.length - 1) { index += 1; emit(); } },
    entries: () => stack.slice(0, index + 1).map(copy),
  };
}
