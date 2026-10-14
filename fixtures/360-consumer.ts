import { validateScene } from "@foss-earth/scenes";
import { loadScene, type SceneViewerPorts, type SceneViewerImageInput, type SceneViewerImageDetail, type SceneStatus, type SceneWorldPorts } from "@foss-earth/scenes/browser";
import { createBuiltInRepresentations, validateViewerAsset, type ImageViewer, type ViewerImageInput, type ViewerImageDetail } from "@foss-earth/sphere-image";
import { createImageViewer, type ImageViewerOptions } from "@foss-earth/sphere-image/viewer";
import { createPreviewSheetsExtensionHook } from "@foss-earth/preview-sheets/scene-extension";
declare const imageViewer: ImageViewer;
declare const world: SceneWorldPorts;
declare const tiledParameters: Parameters<typeof createBuiltInRepresentations>[0];
declare const input: Record<string, unknown>;
declare const injectedViewerPorts: ImageViewerOptions;
// An actual360 instance satisfies the structural scene port; no source/deep import.
const viewer: SceneViewerPorts = imageViewer;
// Published readings are optional, structurally compatible observations from the viewer owner.
const observedDetail: SceneViewerImageDetail | null | undefined = imageViewer.status().immersionDetail;
declare const sceneStatus: SceneStatus;
const publicViewerDetail: ViewerImageDetail | null | undefined = sceneStatus.immersionDetail;
const plugins = createBuiltInRepresentations(tiledParameters);
const options = { representations: plugins.map(plugin => plugin.hooks), validateImageAsset: validateViewerAsset, extensionHooks: [createPreviewSheetsExtensionHook()] };
const result = validateScene(input, options);
void result;
const launch = () => loadScene(input, { ...options, viewer, world, sessionId: "host-session", markerRadiusMeters: () => 1 });
declare const preparedInput: SceneViewerImageInput;
const publicViewerInput: ViewerImageInput = preparedInput;
// Constructing the optional adapter is an explicit host action with its existing renderer/frame/resource authority.
const hostViewer = () => createImageViewer(injectedViewerPorts);
void launch; void publicViewerInput; void hostViewer; void observedDetail; void publicViewerDetail;
