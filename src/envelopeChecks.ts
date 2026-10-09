import { ImageRecordChecker as Checker, resolveImageUrl as resolveUrl } from "@foss-earth/images";
import type { AttributionRecord, HeightRecord, ViewRecord, LinkRecord, ResolvedMarkerStyle, ResolvedPanorama, OverviewRecord } from "./format.js";
type Json = Record<string, unknown>;
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const OUTLINE_WIDTH_PX = { min: 0, max: 32 };
const HOVER_SCALE = { min: 1, max: 4 };
function checkHeight(checker: Checker, value: unknown, path: string): HeightRecord | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const record = checker.record(value, path);
  if (!record) return null;
  checker.keys(record, path, ["meters", "datum", "source", "uncertaintyMeters"]);
  const meters = checker.finite(record.meters, `${path}.meters`);
  const datum = checker.oneOf(record.datum, `${path}.datum`, ["WGS84-ellipsoid"] as const);
  const source = record.source === undefined ? undefined : checker.text(record.source, `${path}.source`);
  const uncertainty = record.uncertaintyMeters === undefined ? undefined : checker.nonNegative(record.uncertaintyMeters, `${path}.uncertaintyMeters`);
  if (meters === null || datum === null) return null;
  return {
    meters,
    datum,
    ...(source ? { source } : {}),
    ...(uncertainty !== undefined && uncertainty !== null ? { uncertaintyMeters: uncertainty } : {}),
  };
}

function checkView(checker: Checker, value: unknown, path: string): ViewRecord | null {
  const record = checker.record(value, path);
  if (!record) return null;
  checker.keys(record, path, ["headingDeg", "pitchDeg", "verticalFovDeg"]);
  const headingDeg = checker.within(record.headingDeg, `${path}.headingDeg`, 0, 360, true, false);
  const pitchDeg = checker.within(record.pitchDeg, `${path}.pitchDeg`, -90, 90, true, true);
  const verticalFovDeg = checker.within(record.verticalFovDeg, `${path}.verticalFovDeg`, 0, 180, false, false);
  return headingDeg === null || pitchDeg === null || verticalFovDeg === null ? null : { headingDeg, pitchDeg, verticalFovDeg };
}

function checkLongitudeLatitude(checker: Checker, record: Json, path: string): { longitudeDeg: number; latitudeDeg: number } | null {
  const longitudeDeg = checker.within(record.longitudeDeg, `${path}.longitudeDeg`, -180, 180, true, false);
  const latitudeDeg = checker.within(record.latitudeDeg, `${path}.latitudeDeg`, -90, 90, true, true);
  return longitudeDeg === null || latitudeDeg === null ? null : { longitudeDeg, latitudeDeg };
}

export function checkAttribution(checker: Checker, value: unknown, path: string, base: URL | null): AttributionRecord | null {
  const record = checker.record(value, path);
  if (!record) return null;
  checker.keys(record, path, ["text", "license", "url"]);
  const text = checker.text(record.text, `${path}.text`);
  const license = record.license === undefined ? null : checker.text(record.license, `${path}.license`);
  const url = record.url === undefined ? null : resolveUrl(checker, record.url, `${path}.url`, base);
  return text === null ? null : { text, ...(license ? { license } : {}), ...(url ? { url } : {}) };
}

function checkLink(checker: Checker, value: unknown, path: string): LinkRecord | null {
  const record = checker.record(value, path);
  if (!record) return null;
  checker.keys(record, path, ["id", "target", "label", "direction", "arrivalView", "extensions"]);
  const id = checker.id(record.id, `${path}.id`);
  const target = checker.id(record.target, `${path}.target`);
  const label = checker.text(record.label, `${path}.label`);
  let direction: LinkRecord["direction"];
  if (record.direction !== undefined) {
    const dir = checker.record(record.direction, `${path}.direction`);
    if (dir) {
      checker.keys(dir, `${path}.direction`, ["headingDeg", "pitchDeg"]);
      const headingDeg = checker.within(dir.headingDeg, `${path}.direction.headingDeg`, 0, 360, true, false);
      const pitchDeg = checker.within(dir.pitchDeg, `${path}.direction.pitchDeg`, -90, 90, true, true);
      if (headingDeg !== null && pitchDeg !== null) direction = { headingDeg, pitchDeg };
    }
  }
  const arrivalView = record.arrivalView === undefined ? undefined : checkView(checker, record.arrivalView, `${path}.arrivalView`) ?? undefined;
  const extensions = checker.extensions(record.extensions, `${path}.extensions`);
  if (!id || !target || !label) return null;
  return { id, target, label, ...(direction ? { direction } : {}), ...(arrivalView ? { arrivalView } : {}), ...(Object.keys(extensions).length ? { extensions } : {}) };
}

/** A style's own properties: undefined inherits the scene's, null turns it off. */
type StyleOverrides = { outline?: ResolvedMarkerStyle["outline"]; hover?: number | null };

function checkMarkerStyle(checker: Checker, value: unknown, path: string): StyleOverrides {
  const record = checker.record(value, path);
  if (!record) return {};
  checker.keys(record, path, ["outline", "hover"]);
  const style: StyleOverrides = {};
  if (record.outline === null) style.outline = null;
  else if (record.outline !== undefined) {
    const outline = checker.record(record.outline, `${path}.outline`);
    if (outline) {
      checker.keys(outline, `${path}.outline`, ["color", "widthPx"]);
      const text = outline.color;
      if (typeof text !== "string" || !HEX_COLOUR.test(text)) checker.fail(`${path}.outline.color`, "must be a hex colour, #rrggbb or #rrggbbaa");
      const widthPx = checker.within(outline.widthPx, `${path}.outline.widthPx`, OUTLINE_WIDTH_PX.min, OUTLINE_WIDTH_PX.max, true, true);
      if (typeof text === "string" && HEX_COLOUR.test(text) && widthPx !== null) {
        const channel = (index: number): number => parseInt(text.slice(1 + 2 * index, 3 + 2 * index), 16) / 255;
        style.outline = { color: [channel(0), channel(1), channel(2), text.length > 7 ? channel(3) : 1], widthPx };
      }
    }
  }
  if (record.hover === null) style.hover = null;
  else if (record.hover !== undefined) {
    const hover = checker.record(record.hover, `${path}.hover`);
    if (hover) {
      checker.keys(hover, `${path}.hover`, ["scale"]);
      const scale = checker.within(hover.scale, `${path}.hover.scale`, HOVER_SCALE.min, HOVER_SCALE.max, true, true);
      if (scale !== null) style.hover = scale;
    }
  }
  return style;
}

export const checkSceneMarkerStyle = checkMarkerStyle;

function resolveMarkerStyle(scene: StyleOverrides, own: StyleOverrides): ResolvedMarkerStyle {
  const outline = own.outline !== undefined ? own.outline : scene.outline ?? null;
  const hover = own.hover !== undefined ? own.hover : scene.hover ?? null;
  return { outline: outline && outline.widthPx > 0 && outline.color[3] > 0 ? outline : null, hoverScale: hover ?? 1 };
}

export function checkPanorama(checker: Checker, record: Json, path: string, sceneStyle: StyleOverrides): ResolvedPanorama | null {
  checker.keys(record, path, ["id", "type", "assetId", "title", "description", "capture", "imagePose", "marker", "initialView", "links", "required", "extensions"]);
  const id = checker.id(record.id, `${path}.id`);
  const assetId = checker.id(record.assetId, `${path}.assetId`);
  const title = checker.text(record.title, `${path}.title`);
  const description = record.description === undefined ? undefined : checker.text(record.description, `${path}.description`) ?? undefined;
  if (record.required !== undefined && typeof record.required !== "boolean") checker.fail(`${path}.required`, "must be true or false");

  const captureRecord = checker.record(record.capture, `${path}.capture`);
  let capture: ResolvedPanorama["capture"] | null = null;
  if (captureRecord) {
    checker.keys(captureRecord, `${path}.capture`, ["longitudeDeg", "latitudeDeg", "height", "horizontalAccuracyMeters"]);
    const place = checkLongitudeLatitude(checker, captureRecord, `${path}.capture`);
    const height = checkHeight(checker, captureRecord.height, `${path}.capture.height`);
    const accuracy = captureRecord.horizontalAccuracyMeters === undefined ? undefined : checker.nonNegative(captureRecord.horizontalAccuracyMeters, `${path}.capture.horizontalAccuracyMeters`);
    if (place) capture = { ...place, height: height ?? null, ...(accuracy !== undefined && accuracy !== null ? { horizontalAccuracyMeters: accuracy } : {}) };
  }

  const poseRecord = checker.record(record.imagePose, `${path}.imagePose`);
  let imagePose: ResolvedPanorama["imagePose"] | null = null;
  if (poseRecord) {
    checker.keys(poseRecord, `${path}.imagePose`, ["headingDeg", "pitchDeg", "rollDeg", "aligned"]);
    const headingDeg = checker.within(poseRecord.headingDeg, `${path}.imagePose.headingDeg`, 0, 360, true, false);
    const pitchDeg = checker.within(poseRecord.pitchDeg, `${path}.imagePose.pitchDeg`, -90, 90, true, true);
    const rollDeg = checker.within(poseRecord.rollDeg, `${path}.imagePose.rollDeg`, -180, 180, false, true);
    const aligned = poseRecord.aligned;
    if (aligned !== undefined && typeof aligned !== "boolean") checker.fail(`${path}.imagePose.aligned`, "must be true or false");
    if (headingDeg !== null && pitchDeg !== null && rollDeg !== null) imagePose = { headingDeg, pitchDeg, rollDeg, ...(typeof aligned === "boolean" ? { aligned } : {}) };
  }

  const markerRecord = checker.record(record.marker, `${path}.marker`);
  let marker: ResolvedPanorama["marker"] | null = null;
  if (markerRecord) {
    checker.keys(markerRecord, `${path}.marker`, ["mode", "eastM", "northM", "offsetM", "radiusMeters", "style"]);
    const mode = checker.oneOf(markerRecord.mode, `${path}.marker.mode`, ["ground-relative", "capture-relative"] as const);
    const eastM = checker.finite(markerRecord.eastM, `${path}.marker.eastM`);
    const northM = checker.finite(markerRecord.northM, `${path}.marker.northM`);
    const offsetM = checker.finite(markerRecord.offsetM, `${path}.marker.offsetM`);
    let radiusMeters: number | undefined;
    if (markerRecord.radiusMeters !== undefined) {
      const radius = checker.finite(markerRecord.radiusMeters, `${path}.marker.radiusMeters`);
      if (radius !== null && radius <= 0) checker.fail(`${path}.marker.radiusMeters`, "must be positive");
      else if (radius !== null) radiusMeters = radius;
    }
    if (mode === "capture-relative" && capture && !capture.height) {
      checker.fail(`${path}.marker.mode`, "capture-relative placement needs a known capture height; use ground-relative");
    }
    if (mode && eastM !== null && northM !== null && offsetM !== null) marker = { mode, eastM, northM, offsetM, ...(radiusMeters ? { radiusMeters } : {}) };
  }
  const ownStyle = markerRecord?.style === undefined ? {} : checkMarkerStyle(checker, markerRecord.style, `${path}.marker.style`);

  const initialView = record.initialView === undefined ? undefined : checkView(checker, record.initialView, `${path}.initialView`) ?? undefined;
  const links: LinkRecord[] = [];
  if (record.links !== undefined) {
    const seen = new Set<string>();
    (checker.array(record.links, `${path}.links`) ?? []).forEach((entry, index) => {
      const link = checkLink(checker, entry, `${path}.links[${index}]`);
      if (!link) return;
      if (seen.has(link.id)) checker.fail(`${path}.links[${index}].id`, `repeats link id "${link.id}" in this panorama`);
      seen.add(link.id);
      links.push(link);
    });
  }
  const extensions = checker.extensions(record.extensions, `${path}.extensions`);
  if (!id || !assetId || !title || !capture || !imagePose || !marker) return null;
  return {
    id, type: "panorama", assetId, title, ...(description ? { description } : {}), capture, imagePose, marker,
    ...(initialView ? { initialView } : {}), links, markerStyle: resolveMarkerStyle(sceneStyle, ownStyle), ...(record.required === true ? { required: true } : {}),
    ...(Object.keys(extensions).length ? { extensions } : {}),
  };
}

export function checkOverview(checker: Checker, value: unknown, path: string): OverviewRecord | null {
  const record = checker.record(value, path);
  if (!record) return null;
  checker.keys(record, path, ["target", "distanceMeters", "headingDeg", "pitchDeg", "verticalFovDeg"]);
  const target = checker.record(record.target, `${path}.target`);
  let place: { longitudeDeg: number; latitudeDeg: number } | null = null;
  let height: HeightRecord | null | undefined;
  if (target) {
    checker.keys(target, `${path}.target`, ["longitudeDeg", "latitudeDeg", "height"]);
    place = checkLongitudeLatitude(checker, target, `${path}.target`);
    height = checkHeight(checker, target.height, `${path}.target.height`);
  }
  const distanceMeters = checker.finite(record.distanceMeters, `${path}.distanceMeters`);
  if (distanceMeters !== null && distanceMeters <= 0) checker.fail(`${path}.distanceMeters`, "must be positive");
  const headingDeg = checker.within(record.headingDeg, `${path}.headingDeg`, 0, 360, true, false);
  const pitchDeg = checker.within(record.pitchDeg, `${path}.pitchDeg`, -90, 90, true, true);
  const verticalFovDeg = checker.within(record.verticalFovDeg, `${path}.verticalFovDeg`, 0, 180, false, false);
  if (!place || distanceMeters === null || distanceMeters <= 0 || headingDeg === null || pitchDeg === null || verticalFovDeg === null) return null;
  return { target: { ...place, height: height ?? null }, distanceMeters, headingDeg, pitchDeg, verticalFovDeg };
}
