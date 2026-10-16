import { expect, it, vi } from "vitest";
import { createScenePanelStore } from "../src/panelState.js";

it("persists per-scene expansion, grouping and exact looks with coalesced writes", () => {
  let raw: string | null = null, pending = () => {};
  const storage = { getItem: () => raw, setItem: vi.fn((_key: string, value: string) => { raw = value; }) };
  const make = () => createScenePanelStore({ storage, key: "test", schedule: run => { pending = run; return { cancel() {} }; } });
  const store = make();
  const state = { grouping: "stops" as const, expanded: ["a", "b"], active: "b", looks: { a: { headingDeg: 123, pitchDeg: 21, verticalFovDeg: 77 } } };
  store.set("scene-a", state);
  store.set("scene-a", state);
  expect(storage.setItem).not.toHaveBeenCalled();
  pending();
  expect(storage.setItem).toHaveBeenCalledOnce();
  expect(make().get("scene-a")).toEqual(state);
  expect(make().get("scene-b")).toBeNull();
  store.dispose();
});
it("ignores corrupt storage and invalid camera values and flushes on disposal", () => {
  let raw = '{"version":1,"scenes":{"bad":{"grouping":"stops","expanded":["a"],"looks":{"a":{"headingDeg":null}}}}}';
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  const store = createScenePanelStore({ storage, key: "test", schedule: () => ({ cancel() {} }) });
  expect(store.get("bad")?.looks ?? {}).toEqual({});
  store.set("valid", { grouping: "layers", expanded: ["a"], active: null, looks: {} });
  store.dispose();
  expect(JSON.parse(raw).scenes.valid.expanded).toEqual(["a"]);
});
it("restores only boolean layer preferences and accepts saves from before layer persistence", () => {
  const raw = JSON.stringify({ version: 1, scenes: {
    old: { grouping: "layers", expanded: ["a"], active: null, looks: {} },
    current: { grouping: "layers", expanded: [], active: null, looks: {}, layers: { outdoor: false, "outdoor-360": true, invalid: "false" } },
  } });
  const store = createScenePanelStore({ storage: { getItem: () => raw, setItem() {} }, key: "test", schedule: () => ({ cancel() {} }) });
  expect(store.get("old")?.expanded).toEqual(["a"]);
  expect(store.get("current")?.layers).toEqual({ outdoor: false, "outdoor-360": true });
});
