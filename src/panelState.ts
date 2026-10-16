import type { ViewRecord } from "./format.js";
export interface ScenePanelState {
  grouping: "layers" | "stops";
  expanded: string[];
  active: string | null;
  looks: Record<string, ViewRecord>;
  /** Own checkbox values, independent of ancestor visibility. Absent in older saves. */
  layers?: Record<string, boolean>;
}
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function stateOf(value: unknown): ScenePanelState | null {
  if (!record(value) || !["layers", "stops"].includes(value.grouping as string) || !Array.isArray(value.expanded)) return null;
  const expanded = value.expanded.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 500).slice(0, 1000);
  const looks: Record<string, ViewRecord> = Object.create(null);
  if (record(value.looks)) for (const [id, look] of Object.entries(value.looks).slice(0, 1000)) {
    if (!record(look) || ![look.headingDeg, look.pitchDeg, look.verticalFovDeg].every(n => typeof n === "number" && Number.isFinite(n))) continue;
    if (Math.abs(look.pitchDeg as number) > 90 || (look.verticalFovDeg as number) <= 0 || (look.verticalFovDeg as number) >= 180) continue;
    looks[id] = { headingDeg: look.headingDeg as number, pitchDeg: look.pitchDeg as number, verticalFovDeg: look.verticalFovDeg as number };
  }
  const layers: Record<string, boolean> = Object.create(null);
  if (record(value.layers)) for (const [id, visible] of Object.entries(value.layers).slice(0, 1000)) {
    if (id.length > 0 && id.length < 500 && typeof visible === "boolean") layers[id] = visible;
  }
  return { ...(record(value.layers) ? { layers } : {}), grouping: value.grouping as ScenePanelState["grouping"], expanded, active: typeof value.active === "string" && expanded.includes(value.active) ? value.active : null, looks };
}
/** Small coalesced UI save, separate from authored content and opening preferences. */
export function createScenePanelStore(options: { storage: Storage | null; key: string; schedule(run: () => void, ms: number): { cancel(): void } }) {
  const scenes = new Map<string, ScenePanelState>();
  try {
    const saved: unknown = JSON.parse(options.storage?.getItem(options.key) ?? "null");
    if (record(saved) && saved.version === 1 && record(saved.scenes)) for (const [id, value] of Object.entries(saved.scenes).slice(-16)) {
      const state = stateOf(value); if (state) scenes.set(id, state);
    }
  } catch { /* A disabled or unreadable store leaves the session usable. */ }
  let pending: { cancel(): void } | null = null;
  let dirty = false;
  const flush = (): void => {
    pending?.cancel(); pending = null;
    if (!dirty) return;
    try { options.storage?.setItem(options.key, JSON.stringify({ version: 1, scenes: Object.fromEntries(scenes) })); } catch { /* Keep the session state. */ }
    dirty = false;
  };
  return {
    get: (id: string) => scenes.get(id) ?? null,
    set(id: string, value: ScenePanelState) {
      if (JSON.stringify(scenes.get(id)) === JSON.stringify(value)) return;
      scenes.delete(id); scenes.set(id, value);
      while (scenes.size > 16) scenes.delete(scenes.keys().next().value!);
      dirty = true;
      pending ??= options.schedule(flush, 300);
    },
    flush, dispose: flush,
  };
}
