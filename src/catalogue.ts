/** Document controls only. Image, viewer and tile owners contribute their own existing homes. */
export const SCENES_TAB = "scenes";
export interface SceneDocumentParameter {
  id: string; label: string; description: string; unit: "MiB" | "count"; kind: "number";
  bounds(): { min: number; max: number }; scale: "linear" | "log2"; step?: number;
  default: number; defaultReason: string;
  home: { tab: typeof SCENES_TAB; section: "content"; level: "all" };
  appliesLive: true; source: string;
}
const quantity = (spec: Omit<SceneDocumentParameter, "kind" | "home" | "appliesLive" | "source">): SceneDocumentParameter => ({
  ...spec, kind: "number", home: { tab: SCENES_TAB, section: "content", level: "all" }, appliesLive: true, source: "@foss-earth/scenes/browser",
});
export const SCENE_DOCUMENT_PARAMETERS: readonly SceneDocumentParameter[] = [
  quantity({ id: "scene.manifestMiB", label: "Largest scene manifest", unit: "MiB", bounds: () => ({ min: 0.1, max: 16 }), default: 2, scale: "log2", description: "A manifest larger than this is refused before it is parsed.", defaultReason: "Bounds parsing; far above a scene of a few thousand panoramas." }),
  quantity({ id: "scene.entityLimit", label: "Most entities in a scene", unit: "count", bounds: () => ({ min: 1, max: 100_000 }), default: 2000, scale: "log2", step: 0.25, description: "A scene listing more entities is refused before anything is built for it.", defaultReason: "Bounds the discovery data held for the list; the stage 2 scale fixture uses 200." }),
  quantity({ id: "scene.assetLimit", label: "Most images in a scene", unit: "count", bounds: () => ({ min: 1, max: 100_000 }), default: 2000, scale: "log2", step: 0.25, description: "A scene describing more images is refused before any resource is described.", defaultReason: "Bounds resource descriptors, one per image." }),
  quantity({ id: "scene.linkLimit", label: "Most links in a scene", unit: "count", bounds: () => ({ min: 0, max: 1_000_000 }), default: 10_000, scale: "linear", step: 1, description: "A scene with more links between its panoramas is refused.", defaultReason: "Bounds the navigation graph: five links for each of 2000 panoramas." }),
];
export const SCENE_SECTION_TITLES: ReadonlyArray<readonly [string, string, string]> = [
  [SCENES_TAB, "content", "Content"], [SCENES_TAB, "credits", "Credits"],
];
