import { ImageRecordChecker, isRecord, type ImageAsset, type ImageRepresentation, type RepresentationHooks } from "@foss-earth/images";
import { SCENE_FORMAT, SCENE_FORMAT_VERSION, type SceneDiagnostic, type SceneValidation, type ResolvedAsset, type ResolvedSphere, type UnsupportedEntity, type GroupRecord, type ExternalDestinationRecord, type SceneFeatureRecord, type SceneLayerRecord } from "./format.js";
import { checkAttribution, checkOverview, checkSphere, checkSceneMarkerStyle } from "./envelopeChecks.js";

export interface SceneLimits { manifestBytes: number; entities: number; assets: number; links: number }
export const DEFAULT_SCENE_LIMITS: Readonly<SceneLimits> = Object.freeze({ manifestBytes: 2 * 1024 * 1024, entities: 2000, assets: 2000, links: 10000 });
/** A registered owner reads its own optional data; unknown names remain inert. */
export interface SceneExtensionHook {
  readonly name: string;
  validateDocument(value: unknown, context: { path: string; baseUrl: string | null; maxAssets: number }): { data: unknown; warnings: readonly SceneDiagnostic[] };
  resolveRepresentation?(representation: ImageRepresentation, context: { path: string; baseUrl: string | null; documentData: unknown }): { representation: ImageRepresentation; warnings: readonly SceneDiagnostic[] };
}
export interface ValidateSceneOptions {
  baseUrl?: string | URL | null;
  limits?: Partial<SceneLimits>;
  /** Built-in and custom registrations belong to the supplied viewer catalogue. */
  representations: readonly RepresentationHooks[];
  /** The viewer enforces its asset-level v1 support policy, including a complete preview. */
  validateImageAsset(asset: ImageAsset, context: { path: string }): readonly SceneDiagnostic[];
  extensionHooks?: readonly SceneExtensionHook[];
}

/** Pure v1 envelope validation; no image structure validator, renderer or request is created. */
export function validateScene(input: unknown, options: ValidateSceneOptions): SceneValidation {
  const limits = { ...DEFAULT_SCENE_LIMITS, ...options.limits };
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value >= 0)) throw new RangeError("Scene limits must be nonnegative whole-number byte/count limits.");
  const checker = new ImageRecordChecker();
  let document: unknown = input, text: string;
  try { text = typeof input === "string" ? input : JSON.stringify(input) ?? ""; }
  catch (error) { return { ok: false, errors: [{ path: "$", message: `is not serializable JSON: ${String(error)}` }] }; }
  const manifestBytes = new TextEncoder().encode(text).byteLength;
  if (manifestBytes > limits.manifestBytes) return { ok: false, errors: [{ path: "$", message: `the manifest is ${manifestBytes} bytes, over the ${limits.manifestBytes}-byte limit (scene.manifestMiB)` }] };
  if (typeof input === "string") {
    try { document = JSON.parse(input); }
    catch (error) { return { ok: false, errors: [{ path: "$", message: `is not JSON: ${error instanceof Error ? error.message : String(error)}` }] }; }
  }
  const root = checker.record(document, "$");
  if (!root) return { ok: false, errors: checker.errors };
  if (root.format !== SCENE_FORMAT) return { ok: false, errors: [{ path: "$.format", message: `must be "${SCENE_FORMAT}"` }] };
  if (root.version !== SCENE_FORMAT_VERSION) return { ok: false, errors: [{ path: "$.version", message: `version ${JSON.stringify(root.version)} is not supported; this loader reads version ${SCENE_FORMAT_VERSION}, and migrations are explicit tools` }] };
  const countOf = (value: unknown): number => Array.isArray(value) ? value.length : 0;
  if (countOf(root.entities) > limits.entities) checker.fail("$.entities", `has ${countOf(root.entities)} entities, over the limit of ${limits.entities} (scene.entityLimit)`);
  if (countOf(root.assets) > limits.assets) checker.fail("$.assets", `has ${countOf(root.assets)} assets, over the limit of ${limits.assets} (scene.assetLimit)`);
  const linkCount = Array.isArray(root.entities) ? root.entities.reduce((sum: number, entity) => sum + (isRecord(entity) && Array.isArray(entity.links) ? entity.links.length : 0), 0) : 0;
  if (linkCount > limits.links) checker.fail("$.entities", `has ${linkCount} links, over the limit of ${limits.links} (scene.linkLimit)`);
  if (checker.errors.length) return { ok: false, errors: checker.errors };

  if (!Array.isArray(options.representations) || typeof options.validateImageAsset !== "function") throw new Error("The host must supply representation validators and an image-asset support policy.");
  const representations = new Map<string, RepresentationHooks>();
  for (const hook of options.representations) {
    if (!hook || typeof hook.projection !== "string" || !hook.projection || typeof hook.validate !== "function" || representations.has(hook.projection)) throw new Error("Representation registrations require unique projections and public validators.");
    representations.set(hook.projection, hook);
  }
  const hooks = new Map<string, SceneExtensionHook>();
  for (const hook of options.extensionHooks ?? []) {
    if (!hook || !/^[a-z0-9-]+(\.[A-Za-z0-9_-]+)+$/.test(hook.name) || typeof hook.validateDocument !== "function" || hooks.has(hook.name)) throw new Error("Extension registrations require unique namespaced names and owner validators.");
    hooks.set(hook.name, hook);
  }
  let base: URL | null = null;
  if (options.baseUrl) { try { base = new URL(String(options.baseUrl)); } catch { checker.fail("$", `the base URL ${String(options.baseUrl)} is not a URL`); } }
  checker.keys(root, "$", ["format", "version", "id", "revision", "title", "requiredExtensions", "extensions", "assets", "entities", "groups", "layers", "initialPanorama", "overview", "markerStyle", "externalDestinations"]);
  const sceneStyle = root.markerStyle === undefined ? {} : checkSceneMarkerStyle(checker, root.markerStyle, "$.markerStyle");
  const id = checker.id(root.id, "$.id"), revision = checker.text(root.revision, "$.revision"), title = checker.text(root.title, "$.title");
  const extensions = checker.extensions(root.extensions, "$.extensions");
  const externalDestinations = new Map<string, ExternalDestinationRecord>();
  if (root.externalDestinations !== undefined) {
    const declared = checker.array(root.externalDestinations, "$.externalDestinations") ?? [];
    if (declared.length > limits.entities) checker.fail("$.externalDestinations", "exceeds the finite destination limit");
    declared.forEach((value, index) => {
      const path = `$.externalDestinations[${index}]`, record = checker.record(value, path);
      if (!record) return;
      checker.keys(record, path, ["id", "sceneId", "routeId"]);
      const destinationId = checker.id(record.id, `${path}.id`), sceneId = checker.id(record.sceneId, `${path}.sceneId`);
      const routeId = record.routeId === undefined ? null : checker.id(record.routeId, `${path}.routeId`);
      if (sceneId === id) checker.fail(`${path}.sceneId`, "must name an external scene, not this scene");
      if (destinationId && externalDestinations.has(destinationId)) checker.fail(`${path}.id`, "repeats an external destination ID");
      if (destinationId && sceneId) externalDestinations.set(destinationId, { id: destinationId, sceneId, ...(routeId ? { routeId } : {}) });
    });
  }
  if (root.requiredExtensions !== undefined) (checker.array(root.requiredExtensions, "$.requiredExtensions") ?? []).forEach((name, index) => {
    const path = `$.requiredExtensions[${index}]`;
    if (typeof name !== "string") checker.fail(path, "must be an extension name");
    else if (!(name in extensions)) checker.fail(path, `names "${name}", which is not a key of "extensions"`);
    else if (!hooks.has(name)) checker.fail(path, `requires the extension "${name}", which this loader does not support`);
  });
  const extensionData = new Map<string, unknown>();
  for (const [name, hook] of hooks) {
    if (!(name in extensions)) continue;
    const result = hook.validateDocument(extensions[name], { path: `$.extensions.${name}`, baseUrl: base?.href ?? null, maxAssets: limits.assets });
    extensionData.set(name, result.data); checker.warnings.push(...result.warnings);
  }

  const assets = new Map<string, ResolvedAsset>(), unsupportedAssets = new Map<string, string>();
  (checker.array(root.assets, "$.assets") ?? []).forEach((entry, index) => {
    const path = `$.assets[${index}]`, record = checker.record(entry, path);
    if (!record) return;
    const assetId = checker.id(record.id, `${path}.id`);
    if (!assetId) return;
    if (assets.has(assetId) || unsupportedAssets.has(assetId)) checker.fail(`${path}.id`, `repeats asset id "${assetId}"`);
    if (record.type !== "panorama-image") {
      if (typeof record.type !== "string") checker.fail(`${path}.type`, "must be text");
      else { checker.warn(`${path}.type`, `asset type "${record.type}" is not supported by this loader`); unsupportedAssets.set(assetId, record.type); }
      return;
    }
    checker.keys(record, path, ["id", "revision", "type", "colorSpace", "alpha", "attribution", "representations", "extensions"]);
    const revision = checker.text(record.revision, `${path}.revision`);
    const colorSpace = checker.oneOf(record.colorSpace, `${path}.colorSpace`, ["srgb"] as const), alpha = checker.oneOf(record.alpha, `${path}.alpha`, ["opaque"] as const);
    const attribution = checkAttribution(checker, record.attribution, `${path}.attribution`, base);
    const extensions = checker.extensions(record.extensions, `${path}.extensions`);
    const found: ImageRepresentation[] = [], seen = new Set<string>();
    (checker.array(record.representations, `${path}.representations`) ?? []).forEach((candidate, at) => {
      const repPath = `${path}.representations[${at}]`, record = checker.record(candidate, repPath);
      if (!record) return;
      const hook = typeof record.projection === "string" ? representations.get(record.projection) : undefined;
      if (!hook) {
        if (typeof record.projection === "string") checker.warn(`${repPath}.projection`, `projection "${record.projection}" is not supported by this loader; this representation is skipped`);
        else checker.fail(`${repPath}.projection`, "must name a supplied representation projection");
        return;
      }
      const result = hook.validate(record, { path: repPath, baseUrl: base?.href ?? null });
      if (!result.ok) { checker.errors.push(...result.errors); return; }
      checker.warnings.push(...result.warnings);
      let representation = result.representation;
      for (const [name, extensionHook] of hooks) {
        if (!extensionHook.resolveRepresentation || representation.extensions?.[name] === undefined) continue;
        const resolved = extensionHook.resolveRepresentation(representation, { path: `${repPath}.extensions.${name}`, baseUrl: base?.href ?? null, documentData: extensionData.get(name) });
        representation = resolved.representation; checker.warnings.push(...resolved.warnings);
      }
      if (seen.has(representation.id)) checker.fail(`${repPath}.id`, `repeats representation id "${representation.id}" in this asset`);
      seen.add(representation.id); found.push(representation);
    });
    if (!revision || !colorSpace || !alpha || !attribution) return;
    const asset: ResolvedAsset = { id: assetId, revision, type: "panorama-image", colorSpace, alpha, attribution, representations: found, ...(Object.keys(extensions).length ? { extensions } : {}) };
    checker.errors.push(...options.validateImageAsset(asset, { path })); assets.set(assetId, asset);
  });

  const spheres = new Map<string, ResolvedSphere>(), unsupported = new Map<string, UnsupportedEntity>(), entityPaths = new Map<string, string>(), entityOrder: string[] = [];
  (checker.array(root.entities, "$.entities") ?? []).forEach((entry, index) => {
    const path = `$.entities[${index}]`, record = checker.record(entry, path);
    if (!record) return;
    const entityId = checker.id(record.id, `${path}.id`);
    if (!entityId) return;
    if (entityPaths.has(entityId)) { checker.fail(`${path}.id`, `repeats entity id "${entityId}"`); return; }
    entityPaths.set(entityId, path); entityOrder.push(entityId);
    if (record.type !== "panorama") {
      const type = typeof record.type === "string" ? record.type : "(none)";
      if (record.required === true) checker.fail(`${path}.type`, `entity type "${type}" is required but not supported by this loader`);
      else { checker.warn(`${path}.type`, `entity type "${type}" is not supported; it is listed but not shown`); unsupported.set(entityId, { id: entityId, type, reason: `This loader does not show "${type}" entities.` }); }
      return;
    }
    const sphere = checkSphere(checker, record, path, sceneStyle);
    if (!sphere) return;
    if (!assets.has(sphere.assetId)) {
      if (unsupportedAssets.has(sphere.assetId)) {
        const reason = `Its asset "${sphere.assetId}" is a "${unsupportedAssets.get(sphere.assetId)}", which this loader does not show.`;
        if (sphere.required) checker.fail(`${path}.assetId`, reason); else unsupported.set(sphere.id, { id: sphere.id, type: "panorama", reason });
      } else checker.fail(`${path}.assetId`, `refers to asset "${sphere.assetId}", which the scene does not define`);
      return;
    }
    spheres.set(sphere.id, sphere);
  });
  for (const sphere of spheres.values()) sphere.links.forEach((link, index) => {
    if (link.externalDestination !== undefined) {
      if (!externalDestinations.has(link.externalDestination)) checker.fail(`${entityPaths.get(sphere.id)!}.links[${index}].externalDestination`, "names no declared external destination");
      return;
    }
    if (spheres.has(link.target)) return;
    const path = `${entityPaths.get(sphere.id)!}.links[${index}].target`;
    if (unsupported.has(link.target)) checker.warn(path, `leads to "${link.target}", which is not supported; the link is listed disabled`);
    else checker.fail(path, `leads to "${link.target}", which is not a panorama in this scene`);
  });
  const groups: GroupRecord[] = [];
  if (root.groups !== undefined) {
    const seen = new Set<string>();
    (checker.array(root.groups, "$.groups") ?? []).forEach((entry, index) => {
      const path = `$.groups[${index}]`, record = checker.record(entry, path);
      if (!record) return;
      checker.keys(record, path, ["id", "title", "members", "extensions"]);
      const id = checker.id(record.id, `${path}.id`), title = checker.text(record.title, `${path}.title`), extensions = checker.extensions(record.extensions, `${path}.extensions`);
      if (id && seen.has(id)) checker.fail(`${path}.id`, `repeats group id "${id}"`); if (id) seen.add(id);
      const members: string[] = [];
      (checker.array(record.members, `${path}.members`) ?? []).forEach((member, at) => {
        const id = checker.id(member, `${path}.members[${at}]`); if (!id) return;
        if (!entityPaths.has(id)) checker.fail(`${path}.members[${at}]`, `names "${id}", which is not an entity of this scene`);
        else if (members.includes(id)) checker.fail(`${path}.members[${at}]`, `repeats "${id}" in this group`); else members.push(id);
      });
      if (id && title) groups.push({ id, title, members, ...(Object.keys(extensions).length ? { extensions } : {}) });
    });
  }
  const layers = checkLayers(checker, root.layers, entityPaths, spheres);
  let initialPanorama: string | null = null;
  if (root.initialPanorama !== undefined) { const initial = checker.id(root.initialPanorama, "$.initialPanorama"); if (initial && !spheres.has(initial)) checker.fail("$.initialPanorama", `names "${initial}", which is not a supported panorama of this scene`); else initialPanorama = initial; }
  const overview = root.overview === undefined ? null : checkOverview(checker, root.overview, "$.overview");
  if (checker.errors.length || !id || !revision || !title) return { ok: false, errors: checker.errors };
  return { ok: true, scene: { format: SCENE_FORMAT, version: SCENE_FORMAT_VERSION, id, revision, title, baseUrl: base?.href ?? null, assets, extensionData, spheres, entityOrder, unsupported, groups, layers, externalDestinations, initialPanorama, overview, extensions, warnings: checker.warnings, manifestBytes } };
}

function checkLayers(checker: ImageRecordChecker, value: unknown, entities: ReadonlyMap<string, string>, spheres: ReadonlyMap<string, ResolvedSphere>): SceneLayerRecord[] {
  if (value === undefined) return [];
  const seen = new Set<string>();
  const covered = new Set<string>();
  let drawsPanoramas = false;
  const layers = (checker.array(value, "$.layers") ?? []).flatMap((entry, index) => {
    const layer = checkLayer(checker, entry, `$.layers[${index}]`, seen, covered, entities, spheres, found => { drawsPanoramas ||= found; });
    return layer ? [layer] : [];
  });
  if (drawsPanoramas) for (const id of spheres.keys()) if (!covered.has(id)) checker.fail("$.layers", `panorama "${id}" is not in a panoramas layer`);
  return layers;
}

function checkLayer(checker: ImageRecordChecker, value: unknown, path: string, seen: Set<string>, covered: Set<string>, entities: ReadonlyMap<string, string>, spheres: ReadonlyMap<string, ResolvedSphere>, notePanoramas: (found: boolean) => void): SceneLayerRecord | null {
  const record = checker.record(value, path);
  if (!record) return null;
  checker.keys(record, path, ["id", "title", "visible", "layers", "kind", "members", "features"]);
  const id = checker.id(record.id, `${path}.id`), title = checker.text(record.title, `${path}.title`);
  let visible: boolean | undefined;
  if (record.visible !== undefined) {
    if (typeof record.visible !== "boolean") checker.fail(`${path}.visible`, "must be true or false");
    else visible = record.visible;
  }
  if (id && seen.has(id)) checker.fail(`${path}.id`, `repeats layer id "${id}"`);
  if (id) seen.add(id);
  const groups = record.layers !== undefined;
  const kind = record.kind === undefined ? undefined : checker.oneOf(record.kind, `${path}.kind`, ["panoramas", "features"] as const);
  if (groups && kind) checker.fail(path, "groups sublayers or draws content, not both");
  if (!groups && !kind && record.kind === undefined) checker.fail(path, "needs sublayers or a kind");
  const own = visible !== undefined ? { visible } : {};
  if (groups) {
    if (record.members !== undefined) checker.fail(`${path}.members`, "belongs on a panoramas layer");
    if (record.features !== undefined) checker.fail(`${path}.features`, "belongs on a features layer");
    const children = (checker.array(record.layers, `${path}.layers`) ?? []).flatMap((entry, index) => {
      const child = checkLayer(checker, entry, `${path}.layers[${index}]`, seen, covered, entities, spheres, notePanoramas);
      return child ? [child] : [];
    });
    if (Array.isArray(record.layers) && children.length === 0 && !checker.errors.some(error => error.path.startsWith(`${path}.layers`))) checker.fail(`${path}.layers`, "needs a sublayer");
    return id && title ? { id, title, ...own, layers: children } : null;
  }
  if (kind === "panoramas") {
    notePanoramas(true);
    if (record.features !== undefined) checker.fail(`${path}.features`, "belongs on a features layer");
    const members: string[] = [];
    (checker.array(record.members, `${path}.members`) ?? []).forEach((member, at) => {
      const memberId = checker.id(member, `${path}.members[${at}]`);
      if (!memberId) return;
      if (!entities.has(memberId)) checker.fail(`${path}.members[${at}]`, `names "${memberId}", which is not an entity of this scene`);
      else if (members.includes(memberId)) checker.fail(`${path}.members[${at}]`, `repeats "${memberId}" in this layer`);
      else { members.push(memberId); if (spheres.has(memberId)) covered.add(memberId); }
    });
    if (Array.isArray(record.members) && members.length === 0 && !checker.errors.some(error => error.path.startsWith(`${path}.members`))) checker.fail(`${path}.members`, "needs at least one panorama");
    return id && title ? { id, title, ...own, kind, members } : null;
  }
  if (kind === "features") {
    if (record.members !== undefined) checker.fail(`${path}.members`, "belongs on a panoramas layer");
    const features = record.features === undefined ? undefined : checkFeatures(checker, record.features, `${path}.features`);
    return id && title ? { id, title, ...own, kind, ...(features ? { features } : {}) } : null;
  }
  return null;
}

function checkFeatures(checker: ImageRecordChecker, value: unknown, path: string): SceneFeatureRecord[] | undefined {
  const features: SceneFeatureRecord[] = [];
  const seen = new Set<string>();
  let ok = true;
  (checker.array(value, path) ?? []).forEach((entry, index) => {
    const featurePath = `${path}[${index}]`, record = checker.record(entry, featurePath);
    if (!record) { ok = false; return; }
    checker.keys(record, featurePath, ["id", "title", "line"]);
    const id = checker.id(record.id, `${featurePath}.id`);
    const title = record.title === undefined ? undefined : checker.text(record.title, `${featurePath}.title`);
    if (id && seen.has(id)) checker.fail(`${featurePath}.id`, `repeats feature id "${id}"`);
    if (id) seen.add(id);
    const line: [number, number][] = [];
    (checker.array(record.line, `${featurePath}.line`) ?? []).forEach((position, at) => {
      const positionPath = `${featurePath}.line[${at}]`;
      const pair = checker.array(position, positionPath);
      if (!pair) { ok = false; return; }
      if (pair.length !== 2) { checker.fail(positionPath, "must be longitude and latitude"); ok = false; return; }
      const longitudeDeg = checker.within(pair[0], `${positionPath}[0]`, -180, 180, true, false);
      const latitudeDeg = checker.within(pair[1], `${positionPath}[1]`, -90, 90, true, true);
      if (longitudeDeg === null || latitudeDeg === null) { ok = false; return; }
      line.push([longitudeDeg, latitudeDeg]);
    });
    if (Array.isArray(record.line) && line.length < 2) { checker.fail(`${featurePath}.line`, "needs at least two positions"); ok = false; }
    if (id) features.push({ id, ...(title ? { title } : {}), line });
  });
  return ok ? features : undefined;
}
