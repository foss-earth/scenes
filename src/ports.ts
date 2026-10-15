import type { ImageAsset, ImageAttribution, ImagePose, Mat3, Vec3 } from "@foss-earth/images";
import type { ExternalDestinationRecord, LinkRecord, OverviewRecord, ResolvedSphere, SceneDiagnostic, SceneLayerRecord, ValidatedScene, ViewRecord } from "./format.js";
import type { SceneInput, ResolveSceneInputOptions } from "./manifest.js";
import type { SceneHistoryAdapter } from "./history.js";

export type ScenePhase = "overview" | "preparing" | "entering" | "immersive" | "exiting" | "disposed";
export type SceneActionResult = { ok: true } | { ok: false; reason: "disposed" | "busy" | "cancelled" | "unavailable" | "failed"; message: string };
export interface SceneFailure { kind: "scene" | "preview" | "navigation" | "image"; sphere: { id: string; title: string } | null; cause: string; message: string }
/** Structural match for the public 360 input. No entity resolver crosses this boundary. */
export interface SceneViewerImageInput {
  id: string; asset: ImageAsset; pose: ImagePose & { aligned?: boolean };
  placement: { marker: Vec3 | null; radiusMeters: number; content: Mat3; outline: { color: readonly [number, number, number, number]; widthPx: number } | null; hoverScale: number };
  title: string; description?: string; credits: ImageAttribution; initialView?: ViewRecord;
  actions: readonly { id: string; label: string; direction?: { headingDeg: number; pitchDeg: number }; activate(): Promise<boolean> | boolean }[];
  details?: { capture?: { latitudeDeg: number; longitudeDeg: number; heightMeters: number | null; horizontalAccuracyMeters: number | null }; groups?: readonly string[] };
}
export interface ScenePreparedImage {
  readonly id: string;
  /** The viewer prepares and publishes image readiness progressively after metadata commit. */
  ready(): Promise<void>;
  updatePlacement(placement: SceneViewerImageInput["placement"]): void;
  hover(active: boolean): void;
  dispose(): void;
}
/** An optional observation published by the supplied viewer, never a scene target or estimate. */
export interface SceneViewerImageDetail {
  representation: string;
  loading: string | null;
  limitation: string | null;
  progress?: readonly string[];
}
export interface SceneViewerStatus { phase: ScenePhase; active: string | null; target: string | null; view?: ViewRecord | null; immersionDetail?: SceneViewerImageDetail | null; credits?: readonly (ImageAttribution & { assetId: string })[]; lastError?: string | null; renderingAvailable?: boolean; unavailableReason?: string | null }
/** One host-owned viewer binding. Its implementation owns GPU, navigation lease, input and frames. */
export interface SceneViewerPorts {
  /** Creates metadata/hidden entries; this must not wait for every preview to download. */
  prepare(input: SceneViewerImageInput, signal: AbortSignal): ScenePreparedImage | Promise<ScenePreparedImage>;
  /** Atomically publishes the new metadata; a throw must leave the previous set usable. */
  replaceImages(images: readonly ScenePreparedImage[]): void;
  /**
   * Hides these published images on the map. They stay in the set, so a list
   * can still enter one whose layer is off.
   */
  setMapVisibility(hiddenIds: readonly string[]): void;
  enter(id: string, options?: { signal?: AbortSignal; view?: ViewRecord }): Promise<boolean>;
  exit(): void;
  status(): SceneViewerStatus;
  subscribe(listener: (status: SceneViewerStatus) => void): () => void;
  pick(clientX: number, clientY: number): readonly string[];
  hover(id: string | null): void;
}
export interface ScenePlacement {
  placement: SceneViewerImageInput["placement"];
  state: "pending" | "placed" | "unavailable";
  message?: string | null;
}
/** Geographic calculations, displayed-ground availability and camera momentum remain host-owned. */
export interface SceneWorldPorts {
  resolvePlacement(entity: ResolvedSphere, options: { radiusMeters: number }): ScenePlacement;
  watchPlacement?(entity: ResolvedSphere, options: { radiusMeters: number }, changed: (placement: ScenePlacement) => void): () => void;
  showOverview(overview: OverviewRecord, options: { signal?: AbortSignal }): Promise<{ ok: true; state: "pending" | "applied" } | Exclude<SceneActionResult, { ok: true }>>;
}
export interface SceneEntryStatus {
  id: string; title: string; description: string | null; supported: boolean; message: string | null;
  placement: "pending" | "placed" | "unavailable"; preview: "idle" | "loading" | "ready" | "failed";
  marker: { mode: "ground-relative" | "capture-relative"; eastM: number; northM: number; offsetM: number; radiusMeters: number; authoredRadius: boolean } | null;
  capture: { longitudeDeg: number; latitudeDeg: number; heightMeters: number | null; horizontalAccuracyMeters: number | null } | null;
  pose: { headingDeg: number; pitchDeg: number; rollDeg: number; aligned: boolean | null } | null;
  attribution: ImageAttribution | null;
  /** Observations supplied by the image/viewer owner; no local format/budget calculations. */
  previewDetail: { representation: string; faceTexels: number; limitation: string | null } | null;
  images: readonly SceneImageStatus[];
  links: readonly { id: string; label: string; target: string; externalDestination?: string; enabled: boolean; placed: boolean }[];
}
export interface SceneImageStatus {
  id: string; role: "preview" | "immersion"; projection: string;
  width: number; height: number; aroundPx: number; encodedBytes: number; gpuBytes: number;
  warp?: string; tiles?: number;
}
export interface SceneLayerStatus {
  id: string;
  title: string;
  /** Absent when this layer only groups sublayers. */
  kind?: SceneLayerRecord["kind"];
  /** This layer's own switch. */
  visible: boolean;
  /** This layer and every layer above it are on. */
  shown: boolean;
  /** The switch can be used. False while a layer above it is off. */
  enabled: boolean;
  /** Panorama orbs follow this. Feature lines are kept and not drawn. */
  drawn: boolean;
  layers: readonly SceneLayerStatus[];
}
export interface SceneStatus extends SceneViewerStatus {
  sceneId: string; revision: string; title: string; generation: number; hovered: string | null;
  entries: readonly SceneEntryStatus[]; groups: ValidatedScene["groups"]; layers: readonly SceneLayerStatus[]; credits: readonly (ImageAttribution & { assetId: string })[];
  overview: "none" | "pending" | "applied"; warnings: readonly SceneDiagnostic[];
  renderingAvailable: boolean; unavailableReason: string | null; lastError: string | null; view: ViewRecord | null;
}
export interface SceneHandle {
  readonly status: SceneStatus; readonly disposed: boolean;
  enter(id: string, options?: { signal?: AbortSignal; view?: ViewRecord }): Promise<SceneActionResult>;
  /** Shows or hides one map layer. False when the scene has no such layer. */
  setLayerVisible(id: string, visible: boolean): boolean;
  follow(linkId: string, options?: { signal?: AbortSignal }): Promise<SceneActionResult>;
  exit(): Promise<SceneActionResult>;
  replace(input: SceneInput, options?: { baseUrl?: string | URL; signal?: AbortSignal }): Promise<{ ok: true } | { ok: false; errors: readonly SceneDiagnostic[] }>;
  showOverview(options?: { signal?: AbortSignal }): Promise<SceneActionResult>;
  pick(clientX: number, clientY: number): readonly string[];
  hover(id: string | null): void;
  hotspots(): readonly { id: string; label: string; x: number; y: number }[];
  subscribe(listener: (status: SceneStatus) => void): () => void;
  onFrame(listener: () => void): () => void;
  /** Useful to a host waiting for cancelled asynchronous owner cleanup. */
  whenSettled(): Promise<void>;
  dispose(): void;
}
export interface SceneExternalNavigationPorts {
  /** The host maps its declared scene/route and named sphere. Scenes fetches nothing. */
  navigate(input: { destination: ExternalDestinationRecord; sphereId: string;
    source: { sceneId: string; revision: string; sphereId: string };
    link: LinkRecord; signal: AbortSignal }): Promise<SceneActionResult>;
}
export interface LoadSceneOptions extends ResolveSceneInputOptions {
  viewer: SceneViewerPorts; world: SceneWorldPorts;
  /** Absent means external links remain listed disabled; local-only hosts stay compatible. */
  externalNavigation?: SceneExternalNavigationPorts;
  /** The current viewer setting, supplied explicitly; no hidden application default. */
  markerRadiusMeters(): number;
  history?: SceneHistoryAdapter;
  /** Existing renderer frame notification, for DOM overlays; never a new clock. */
  frames?: { subscribe(listener: () => void): () => void };
  /** Host/viewer projection of an authored image direction to CSS client coordinates. */
  projectLink?(direction: { headingDeg: number; pitchDeg: number }): { x: number; y: number } | null;
  describeImage?(id: string): { previewDetail?: SceneEntryStatus["previewDetail"]; images?: readonly SceneImageStatus[] };
  /** Explicit host session identity; history from other sessions is never followed. */
  sessionId: string;
  applyOverview?: boolean;
  onFailure?(failure: SceneFailure): void;
}
export type LoadSceneResult = { ok: true; handle: SceneHandle } | { ok: false; errors: readonly SceneDiagnostic[] };
