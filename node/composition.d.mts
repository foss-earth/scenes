import type { NodePreviewSheetsCompositionOptions } from "@foss-earth/preview-sheets/composition-node";
import type { SceneCompositionExtensionOwner, SceneCompositionOptions, SceneCompositionRepresentationOwner, SceneCompositionRequest, SceneCompositionResult } from "@foss-earth/scenes/composition";
export function builtInSceneCompositionOwners(): readonly SceneCompositionRepresentationOwner[];
export function builtInSceneCompositionExtensions(options?: NodePreviewSheetsCompositionOptions): readonly SceneCompositionExtensionOwner[];
export type NodeSceneCompositionOptions = Omit<SceneCompositionOptions, "sha256" | "representations" | "validateImageAsset"> & Partial<Pick<SceneCompositionOptions, "representations" | "validateImageAsset">> & { previewSheets?: NodePreviewSheetsCompositionOptions };
/** Supplied input bytes and public checked leaf owner hooks only; no acquisition, filesystem writes or runtime. */
export function composeScenes(request: SceneCompositionRequest, options: NodeSceneCompositionOptions): SceneCompositionResult;
