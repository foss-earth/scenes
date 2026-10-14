/** Version-one scene envelope; spatial image representations are supplied by their owner. */
import type { ImageAsset, ImageAttribution, ImageDiagnostic, ImageExtensions, ImageRepresentation } from "@foss-earth/images";
export const SCENE_FORMAT = "foss-earth-scene";
export const SCENE_FORMAT_VERSION = 1;
export type SceneExtensions = ImageExtensions;
export type AttributionRecord = ImageAttribution;
export type SceneDiagnostic = ImageDiagnostic;
export type SphereAssetRecord<R extends ImageRepresentation = ImageRepresentation> = ImageAsset<R>;
export type ResolvedAsset<R extends ImageRepresentation = ImageRepresentation> = ImageAsset<R>;
export interface HeightRecord {
  /** Metres above the WGS84 ellipsoid. */
  meters: number;
  datum: "WGS84-ellipsoid";
  /** Where the value came from, and any conversion made during preparation. */
  source?: string;
  uncertaintyMeters?: number;
}

export interface CaptureRecord {
  longitudeDeg: number;
  latitudeDeg: number;
  /** Absent or null when unknown; never a silent zero. */
  height?: HeightRecord | null;
  horizontalAccuracyMeters?: number;
}

export interface ImagePoseRecord {
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /**
   * Whether the heading was set against true north. False: the image faces
   * an arbitrary direction, though pitch and roll may still level it.
   * Absent: the scene does not say.
   */
  aligned?: boolean;
}

/**
 * How orbs look: the scene's `markerStyle`, which a marker's own `style`
 * overrides one property at a time. Null turns an inherited property off.
 */
export interface MarkerStyleRecord {
  /** A ring just outside the orb's silhouette: a CSS hex colour, `#rrggbb` or `#rrggbbaa`, and its width in CSS px. */
  outline?: { color: string; widthPx: number } | null;
  /** While a pointer is over the orb, it grows to `scale` times its size on screen. Entering still takes a click. */
  hover?: { scale: number } | null;
}

export interface MarkerRecord {
  mode: "ground-relative" | "capture-relative";
  eastM: number;
  northM: number;
  offsetM: number;
  /** Overrides `scene.panorama.markerRadiusMeters`; screen-size bounds still apply. */
  radiusMeters?: number;
  style?: MarkerStyleRecord;
}

/** A marker's style with the scene's filled in. */
export interface ResolvedMarkerStyle {
  /** sRGB channels and alpha, 0–1, as authored; width in CSS px. */
  outline: { color: readonly [number, number, number, number]; widthPx: number } | null;
  /** 1 when the orb does not grow on hover. */
  hoverScale: number;
}

export interface ViewRecord {
  headingDeg: number;
  pitchDeg: number;
  verticalFovDeg: number;
}

/** Declared host selection identity; never a fetch URL or guessed URL parameter. */
export interface ExternalDestinationRecord { id: string; sceneId: string; routeId?: string }
export interface LinkRecord {
  id: string;
  target: string;
  /** When present, target is a named sphere in this declared external scene. */
  externalDestination?: string;
  label: string;
  /** Where the hotspot sits in the source sphere's ENU view; without it the link is list-only. */
  direction?: { headingDeg: number; pitchDeg: number };
  /** Overrides the destination's initial view for this arrival. */
  arrivalView?: ViewRecord;
  extensions?: SceneExtensions;
}

export interface SphereEntityRecord {
  id: string;
  type: "panorama";
  assetId: string;
  title: string;
  description?: string;
  capture: CaptureRecord;
  imagePose: ImagePoseRecord;
  marker: MarkerRecord;
  initialView?: ViewRecord;
  links?: readonly LinkRecord[];
  required?: boolean;
  extensions?: SceneExtensions;
}

export interface GroupRecord {
  id: string;
  title: string;
  members: readonly string[];
  extensions?: SceneExtensions;
}

export interface OverviewRecord {
  target: { longitudeDeg: number; latitudeDeg: number; height?: HeightRecord | null };
  /** Positive camera-to-target metres. */
  distanceMeters: number;
  headingDeg: number;
  /** Camera forward; negative looks down. */
  pitchDeg: number;
  verticalFovDeg: number;
}

export interface SceneDocument<R extends ImageRepresentation = ImageRepresentation> {
  format: typeof SCENE_FORMAT;
  version: typeof SCENE_FORMAT_VERSION;
  id: string;
  revision: string;
  title: string;
  requiredExtensions?: readonly string[];
  extensions?: SceneExtensions;
  assets: readonly SphereAssetRecord<R>[];
  entities: readonly (SphereEntityRecord | { id: string; type: string; required?: boolean })[];
  groups?: readonly GroupRecord[];
  externalDestinations?: readonly ExternalDestinationRecord[];
  initialPanorama?: string;
  overview?: OverviewRecord;
  /** Every orb's style, unless its marker's `style` overrides it. */
  markerStyle?: MarkerStyleRecord;
}

export interface ResolvedSphere extends Omit<SphereEntityRecord, "links"> {
  links: readonly LinkRecord[];
  markerStyle: ResolvedMarkerStyle;
}

/** An entity the loader does not know how to show; it stays in the list with a reason. */
export interface UnsupportedEntity {
  id: string;
  type: string;
  reason: string;
}

export interface ValidatedScene<R extends ImageRepresentation = ImageRepresentation> {
  format: typeof SCENE_FORMAT;
  version: typeof SCENE_FORMAT_VERSION;
  id: string;
  revision: string;
  title: string;
  /** Where relative URLs were resolved from. */
  baseUrl: string | null;
  assets: ReadonlyMap<string, ResolvedAsset<R>>;
  /** Validated optional extension data stays opaque to the envelope owner. */
  extensionData: ReadonlyMap<string, unknown>;
  spheres: ReadonlyMap<string, ResolvedSphere>;
  /** Every entity id in document order, supported or not, for the list. */
  entityOrder: readonly string[];
  unsupported: ReadonlyMap<string, UnsupportedEntity>;
  groups: readonly GroupRecord[];
  /** Optional for legacy structural hosts; validated v1 documents always supply it. */
  externalDestinations?: ReadonlyMap<string, ExternalDestinationRecord>;
  initialPanorama: string | null;
  overview: OverviewRecord | null;
  extensions: SceneExtensions;
  /** Kept and reported, not fatal. */
  warnings: readonly SceneDiagnostic[];
  /** Encoded bytes of the manifest itself. */
  manifestBytes: number;
}

export type SceneValidation<R extends ImageRepresentation = ImageRepresentation> =
  | { ok: true; scene: ValidatedScene<R> }
  | { ok: false; errors: readonly SceneDiagnostic[] };
