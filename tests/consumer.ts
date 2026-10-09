import { SCENE_FORMAT, SCENE_FORMAT_VERSION, validateScene, SCENE_DOCUMENT_PARAMETERS, checkSceneFiles as checkDeclaredSceneFiles } from "@foss-earth/scenes";
import { createSavedImagesSection, connectSceneLog, type LoadSceneOptions, type SceneViewerPorts, type SceneWorldPorts, type SceneLogController, type SavedImagesSectionOptions } from "@foss-earth/scenes/browser";
import { builtInSceneHooks, checkSceneFiles, checkSceneManifest, type SceneCheckSummary } from "@foss-earth/scenes/node";
import { buildScenePreviewSheets } from "@foss-earth/scenes/preview-sheets";
// Common owner contract is public from images; the scene root reexports scene types only.
import type { RepresentationHooks as ImageRepresentationHooks } from "@foss-earth/images";
import type { MediaStore } from "@foss-earth/images";
import type { GameLog } from "@foss-earth/ui";
declare const representations: readonly ImageRepresentationHooks[];
declare const viewer: SceneViewerPorts;
declare const world: SceneWorldPorts;
const options: LoadSceneOptions = { representations, validateImageAsset: () => [], viewer, world, sessionId: "explicit-host-session", markerRadiusMeters: () => 1 };
const result = validateScene({ format: SCENE_FORMAT, version: SCENE_FORMAT_VERSION, id: "host.scene", revision: "r1", title: "Host scene", assets: [], entities: [] }, options);
void result; void SCENE_DOCUMENT_PARAMETERS;
const hooks = builtInSceneHooks();
if (result.ok) { checkSceneFiles(result.scene, () => null, hooks); checkDeclaredSceneFiles(result.scene, () => null, { representations: hooks }); }
const report = checkSceneManifest("fixture.scene.json", { baseUrl: new URL("https://host.example/fixture.scene.json") });
const summary: SceneCheckSummary | null = report.summary;
void summary;
const prepared = buildScenePreviewSheets("fixture.scene.json", { faceSize: 8, quality: 80, maxPixels: 4_000_000 });
const retainedRevision: unknown = prepared.document.revision;
void retainedRevision;
export function composeScenePresentation(document: Document, source: MediaStore, refresh: SavedImagesSectionOptions["refresh"], maxListedGroups: () => number, controller: SceneLogController, log: GameLog) {
  const saved = createSavedImagesSection({ document, source, refresh, maxListedGroups });
  const offLog = connectSceneLog(controller, log);
  return { contribution: { ...saved, section: "saved" as const, title: "Saved images" }, offLog };
}
// This file never starts a viewer or transport; it compiles solely against public declarations.
