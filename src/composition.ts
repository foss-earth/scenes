/** Checked, deterministic preparation of one v1 scene. No transport or runtime is created. */
import { isRecord, type ImageRepresentation, type RepresentationHooks } from "@foss-earth/images";
import { checkSceneFiles, type SceneExtensionFile, type SceneRepresentationFileHook } from "./checkSceneFiles.js";
import { SCENE_FORMAT, SCENE_FORMAT_VERSION, type SceneDocument, type SceneDiagnostic, type LinkRecord, type GroupRecord, type OverviewRecord, type ValidatedScene } from "./format.js";
import { validateScene, type SceneExtensionHook, type ValidateSceneOptions } from "./validateScene.js";

export interface SceneArtifactPin { url: string; sha256: string; sizeBytes: number }
export interface SceneCompositionChild {
  key: string;
  /** The final immutable manifest URL, not a redirect's requested URL. */
  manifest: SceneArtifactPin & { id: string; revision: string };
  /** An independently pinned index of unchanged media, including shared sheets. */
  media: SceneArtifactPin & { id: string; revision: string; baseUrl: string };
  aliases?: Partial<Record<SceneCompositionIdKind, Readonly<Record<string, string>>>>;
}
export type SceneCompositionIdKind = "assets" | "entities" | "groups";
export interface SceneChildReference { child: string; id: string }
export interface SceneCompositionLink {
  from: SceneChildReference;
  to: SceneChildReference;
  /** Everything except target is explicitly authored by the consumer. */
  link: Omit<LinkRecord, "target" | "externalDestination">;
  /** Consume this existing declared external link exactly once; retain its metadata. */
  consume?: string;
  /** Default append; consumed links keep their existing position without this edit. */
  insert?: { before: string } | { after: string } | { index: number };
}
export interface SceneCompositionGroupReplacement {
  consume: readonly SceneChildReference[];
  group: Omit<GroupRecord, "members">;
  members: readonly SceneChildReference[];
  /** Required for extensions; their owner receives this explicit child context. */
  contextChild?: string;
}
export type SceneCompositionGroupReference = SceneChildReference | { composed: string };
export interface SceneCompositionRequest {
  schemaVersion: 1;
  id: string;
  revision: string;
  title: string;
  children: readonly SceneCompositionChild[];
  /** A complete permutation: no implicit geographic ordering or omitted stops. */
  entityOrder: readonly SceneChildReference[];
  /** When absent, preserve child order and each child's authored group order. */
  groupOrder?: readonly SceneCompositionGroupReference[];
  groupReplacements?: readonly SceneCompositionGroupReplacement[];
  initialPanorama?: SceneChildReference;
  /** Never inferred from either child's overview. */
  overview?: OverviewRecord;
  links?: readonly SceneCompositionLink[];
}
export interface SceneMediaIndex {
  format: "foss-earth-scene-media";
  version: 1;
  id: string;
  revision: string;
  /** Relative URLs resolve against the explicit child media base. */
  files: readonly SceneArtifactPin[];
}
export interface SceneCompositionLimits {
  requestBytes: number;
  manifestBytes: number;
  mediaIndexBytes: number;
  children: number;
  entities: number;
  assets: number;
  groups: number;
  links: number;
  representations: number;
  files: number;
  fileReferences: number;
  fileBytes: number;
  totalInputBytes: number;
  jsonNodes: number;
  jsonDepth: number;
}
export const DEFAULT_SCENE_COMPOSITION_LIMITS: Readonly<SceneCompositionLimits> = Object.freeze({
  requestBytes: 2 * 1024 * 1024, manifestBytes: 2 * 1024 * 1024, mediaIndexBytes: 8 * 1024 * 1024,
  children: 32, entities: 2000, assets: 2000, groups: 2000, links: 10000, representations: 8000,
  files: 100000, fileReferences: 400000, fileBytes: 32 * 1024 * 1024, totalInputBytes: 512 * 1024 * 1024,
  jsonNodes: 400000, jsonDepth: 64,
});
export type SceneCompositionErrorCode = "invalid-request" | "limit" | "cancelled" | "missing-input" | "drift" | "invalid-scene" | "collision" | "reference" | "owner-required" | "media";
export class SceneCompositionError extends Error {
  readonly code: SceneCompositionErrorCode;
  readonly path: string;
  constructor(code: SceneCompositionErrorCode, path: string, message: string) {
    super(`${path}: ${message}`); this.code = code; this.path = path; this.name = "SceneCompositionError";
  }
}
export interface SceneCompositionChildContext {
  key: string;
  baseUrl: string;
  /** Strict, reversible mapping of envelope-owned IDs only. */
  resolveId(kind: SceneCompositionIdKind, id: string): string;
}
export interface SceneCompositionRepresentationOwner extends SceneRepresentationFileHook {
  validate: RepresentationHooks["validate"];
  estimate: RepresentationHooks["estimate"];
  /** Return a publishable owner record with absolute media URLs, not resolved runtime fields. */
  compose(record: ImageRepresentation, context: { path: string; child: SceneCompositionChildContext }): ImageRepresentation;
}
export interface SceneCompositionExtensionOwner {
  name: string;
  validation: SceneExtensionHook;
  /** Owner decides merging, shared-record equivalence and any reversible extension-ID aliases. */
  composeDocument(entries: readonly { value: Readonly<Record<string, unknown>>; path: string; child: SceneCompositionChildContext }[], context: { limits: Readonly<SceneCompositionLimits>; signal?: AbortSignal }): {
    document?: Readonly<Record<string, unknown>>;
    /** Private owner state, passed unchanged to rewrite; never published by Scenes. */
    state?: unknown;
  };
  rewrite(value: Readonly<Record<string, unknown>>, context: {
    scope: "asset" | "representation" | "entity" | "link" | "group";
    path: string;
    child: SceneCompositionChildContext;
    state: unknown;
    /** The rewritten containing record, before this extension is installed. */
    record: Readonly<Record<string, unknown>>;
  }): Readonly<Record<string, unknown>>;
  files?(scene: ValidatedScene): Iterable<SceneExtensionFile>;
  /** Optional owner content/equivalence check, using only already verified declared bytes. */
  verifyFiles?(scene: ValidatedScene, read: (absoluteUrl: string) => Uint8Array | null, context: { limits: Readonly<SceneCompositionLimits>; signal?: AbortSignal }): Iterable<SceneDiagnostic>;
}
export interface SceneCompositionOptions {
  /** Explicit, already acquired bytes keyed by exact absolute final URL. No implicit reads. */
  inputs: ReadonlyMap<string, Uint8Array>;
  /** SHA-256 over exactly these bytes; the Node adapter supplies the standard implementation. */
  sha256(bytes: Uint8Array): string;
  representations: readonly SceneCompositionRepresentationOwner[];
  validateImageAsset: ValidateSceneOptions["validateImageAsset"];
  extensions?: readonly SceneCompositionExtensionOwner[];
  limits?: Partial<SceneCompositionLimits>;
  /** Checked between bounded jobs. Acquisition/abort/cleanup stays with the host. */
  signal?: AbortSignal;
}
export interface SceneCompositionResult {
  document: SceneDocument;
  /** Stable sorted-object-key JSON, authored array order, two-space indent and final LF. */
  manifest: string;
  sha256: string;
  sizeBytes: number;
  provenance: {
    /** Hash of the canonical finite request, including authored order/navigation and bases. */
    requestSha256: string;
    children: readonly SceneCompositionChild[];
    aliases: readonly { child: string; kind: SceneCompositionIdKind; originalId: string; outputId: string }[];
    groupReplacements: readonly { outputId: string; consumed: readonly SceneChildReference[]; members: readonly SceneChildReference[] }[];
    linkMappings: readonly { child: string; entityId: string; linkId: string; to: SceneChildReference; consumed: boolean }[];
    assets: readonly { child: string; originalId: string; outputId: string; mediaId: string; mediaRevision: string; mediaIndexSha256: string }[];
    /** Unique referenced files; a shared immutable sheet/file is verified once. */
    files: readonly (SceneArtifactPin & { children: readonly string[] })[];
    verifiedMediaFiles: number;
    verifiedInputBytes: number;
    declaredFileReferences: number;
    warnings: readonly SceneDiagnostic[];
  };
}

type ObjectRecord = Record<string, unknown>;
interface ChildState {
  pin: SceneCompositionChild;
  document: ObjectRecord;
  validated: ValidatedScene;
  media: Map<string, SceneArtifactPin>;
  ids: Record<SceneCompositionIdKind, Map<string, string>>;
  context: SceneCompositionChildContext;
}
const ID = /^[A-Za-z0-9._-]+$/;
const DIGEST = /^[a-f0-9]{64}$/;
const own = (record: ObjectRecord, key: string) => Object.hasOwn(record, key);
function fail(code: SceneCompositionErrorCode, path: string, message: string): never { throw new SceneCompositionError(code, path, message); }
const utf8 = (value: string) => new TextEncoder().encode(value);
const asRecord = (value: unknown, path: string): ObjectRecord => isRecord(value) ? value : fail("invalid-request", path, "must be an object");
const asArray = (value: unknown, path: string): unknown[] => Array.isArray(value) ? value : fail("invalid-request", path, "must be an array");
const identifier = (value: unknown, path: string): string => typeof value === "string" && ID.test(value) ? value : fail("invalid-request", path, "must be a v1 ID");
const text = (value: unknown, path: string): string => typeof value === "string" && value.trim() ? value : fail("invalid-request", path, "must be nonempty text");
function keys(record: ObjectRecord, names: readonly string[], path: string): void {
  for (const key of Object.keys(record)) if (!names.includes(key)) fail("invalid-request", `${path}.${key}`, "unknown field");
}
function absoluteUrl(value: unknown, path: string, base?: string): string {
  try {
    if (typeof value !== "string" || !value) return fail("invalid-request", path, "must be a URL");
    const url = base === undefined ? new URL(value) : new URL(value, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) return fail("invalid-request", path, "must be a credential-free HTTP(S) URL without a fragment");
    return url.href;
  } catch (error) {
    if (error instanceof SceneCompositionError) throw error;
    return fail("invalid-request", path, "must be a valid absolute/final URL");
  }
}

/** Pure preparation; the only bytes returned are the derived manifest, never media copies. */
export function composeSceneDocuments(input: SceneCompositionRequest, options: SceneCompositionOptions): SceneCompositionResult {
  const limits = Object.freeze({ ...DEFAULT_SCENE_COMPOSITION_LIMITS, ...options.limits });
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value >= 0)) fail("invalid-request", "$.limits", "limits must be finite nonnegative whole numbers");
  const cancel = () => { if (options.signal?.aborted) fail("cancelled", "$", "composition cancelled; no transport or runtime was started"); };
  const bounded = (count: number, limit: keyof SceneCompositionLimits, path: string) => { if (count > limits[limit]) fail("limit", path, `exceeds ${limit} (${limits[limit]})`); };
  let jsonNodes = 0;
  const canonical = (value: unknown, path: string, depth = 0): unknown => {
    cancel(); bounded(++jsonNodes, "jsonNodes", path); bounded(depth, "jsonDepth", path);
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map((entry, index) => canonical(entry, `${path}[${index}]`, depth + 1));
    if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], `${path}.${key}`, depth + 1)]));
    return fail("invalid-request", path, "must contain only finite JSON data");
  };
  const clone = (value: unknown, path: string): ObjectRecord => asRecord(canonical(value, path), path);
  const hash = (bytes: Uint8Array, path: string): string => {
    cancel(); const digest = options.sha256(bytes); cancel();
    if (!DIGEST.test(digest)) fail("invalid-request", path, "SHA-256 port returned an invalid digest");
    return digest;
  };
  cancel();
  const request = clone(input, "$request") as unknown as SceneCompositionRequest;
  bounded(utf8(JSON.stringify(request)).byteLength, "requestBytes", "$request");
  keys(request as unknown as ObjectRecord, ["schemaVersion", "id", "revision", "title", "children", "entityOrder", "groupOrder", "initialPanorama", "overview", "links", "groupReplacements"], "$request");
  if (request.schemaVersion !== 1) fail("invalid-request", "$request.schemaVersion", "only composition request v1 is supported");
  identifier(request.id, "$request.id"); text(request.revision, "$request.revision"); text(request.title, "$request.title");
  const requestedChildren = asArray(request.children, "$request.children");
  bounded(requestedChildren.length, "children", "$request.children");
  if (!requestedChildren.length) fail("invalid-request", "$request.children", "at least one child is required");
  if (typeof options.sha256 !== "function" || !options.inputs || typeof options.inputs.get !== "function") fail("invalid-request", "$.ports", "explicit input bytes and SHA-256 ports are required");
  const owners = new Map<string, SceneCompositionRepresentationOwner>();
  for (const owner of options.representations) {
    if (!owner.projection || owners.has(owner.projection) || typeof owner.compose !== "function" || typeof owner.validate !== "function" || typeof owner.files !== "function") fail("invalid-request", "$.representations", "unique owner validators, composers and file hooks are required");
    owners.set(owner.projection, owner);
  }
  const extensions = new Map<string, SceneCompositionExtensionOwner>();
  for (const owner of options.extensions ?? []) {
    if (!/^[a-z0-9-]+(\.[A-Za-z0-9_-]+)+$/.test(owner.name) || extensions.has(owner.name) || owner.validation.name !== owner.name || typeof owner.composeDocument !== "function" || typeof owner.rewrite !== "function") fail("invalid-request", "$.extensions", "unique named owner validation/compose/rewrite hooks are required");
    extensions.set(owner.name, owner);
  }
  const inspectGroupExtensionsLater: { group: ObjectRecord; path: string }[] = [];
  const replacementRequests = asArray(request.groupReplacements ?? [], "$request.groupReplacements");
  bounded(replacementRequests.length, "groups", "$request.groupReplacements");
  let consumedInputGroups = 0;
  for (const [at, value] of replacementRequests.entries()) {
    const path = `$request.groupReplacements[${at}]`, record = asRecord(value, path);
    keys(record, ["consume", "group", "members", "contextChild"], path);
    const consume = asArray(record.consume, `${path}.consume`);
    if (!consume.length) fail("invalid-request", `${path}.consume`, "must explicitly consume at least one named group");
    bounded(consume.length, "groups", `${path}.consume`); consumedInputGroups += consume.length;
    const group = asRecord(record.group, `${path}.group`); keys(group, ["id", "title", "extensions"], `${path}.group`);
    identifier(group.id, `${path}.group.id`); text(group.title, `${path}.group.title`); inspectGroupExtensionsLater.push({ group, path });
  }
  const verified = new Map<string, { pin: SceneArtifactPin; bytes: Uint8Array }>();
  let verifiedInputBytes = 0;
  const pinAt = (value: unknown, path: string, base?: string): SceneArtifactPin => {
    const record = asRecord(value, path);
    const url = absoluteUrl(record.url, `${path}.url`, base);
    if (typeof record.sha256 !== "string" || !DIGEST.test(record.sha256)) fail("invalid-request", `${path}.sha256`, "must be a lowercase SHA-256 digest");
    if (!Number.isSafeInteger(record.sizeBytes) || (record.sizeBytes as number) <= 0) fail("invalid-request", `${path}.sizeBytes`, "must be a positive whole-number byte count");
    return { url, sha256: record.sha256, sizeBytes: record.sizeBytes as number };
  };
  const read = (pin: SceneArtifactPin, limit: keyof SceneCompositionLimits, path: string): Uint8Array => {
    cancel(); bounded(pin.sizeBytes, limit, path);
    const prior = verified.get(pin.url);
    if (prior) {
      if (prior.pin.sha256 !== pin.sha256 || prior.pin.sizeBytes !== pin.sizeBytes) fail("drift", path, `conflicting pins for ${pin.url}`);
      return prior.bytes;
    }
    const source = options.inputs.get(pin.url);
    if (!source) fail("missing-input", path, `missing exact input ${pin.url}`);
    if (source.byteLength !== pin.sizeBytes) fail("drift", path, `byte count differs from the pin for ${pin.url}`);
    bounded(verifiedInputBytes + source.byteLength, "totalInputBytes", path);
    const bytes = new Uint8Array(source);
    if (hash(bytes, path) !== pin.sha256) fail("drift", path, `SHA-256 differs from the pin for ${pin.url}`);
    verifiedInputBytes += bytes.byteLength; verified.set(pin.url, { pin, bytes });
    return bytes;
  };
  const parse = (bytes: Uint8Array, path: string): ObjectRecord => {
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return fail("invalid-request", path, "input must be valid UTF-8 JSON"); }
    return clone(value, path);
  };
  const neededExtensions = new Set<string>();
  const inspectExtensions = (record: ObjectRecord, path: string): void => {
    if (record.extensions === undefined) return;
    for (const name of Object.keys(asRecord(record.extensions, `${path}.extensions`))) {
      if (!extensions.has(name)) fail("owner-required", `${path}.extensions.${name}`, `extension owner must supply public composition, rewrite and validation hooks for ${name}`);
      neededExtensions.add(name);
    }
  };
  for (const { group, path } of inspectGroupExtensionsLater) inspectExtensions(group, `${path}.group`);
  const sceneOptions = (baseUrl: string): ValidateSceneOptions => ({
    baseUrl, representations: [...owners.values()], validateImageAsset: options.validateImageAsset,
    extensionHooks: [...extensions.values()].map(owner => owner.validation),
    limits: { manifestBytes: limits.manifestBytes, entities: limits.entities, assets: limits.assets, links: limits.links },
  });
  const validate = (document: ObjectRecord, baseUrl: string, path: string): ValidatedScene => {
    const result = validateScene(document, sceneOptions(baseUrl));
    if (!result.ok) fail("invalid-scene", path, result.errors.map(error => `${error.path}: ${error.message}`).join("; "));
    // Optional runtime fallback is useful for viewing, but must not discard authored media in a build.
    const discarded = result.scene.warnings.filter(warning => warning.path.includes(".extensions.") || warning.path.includes(".representations") || warning.path.endsWith(".assetId"));
    if (discarded.length) fail("invalid-scene", path, discarded.map(error => `${error.path}: ${error.message}`).join("; "));
    for (const entity of result.scene.panoramas.values()) for (const link of entity.links) if (!link.externalDestination && !result.scene.panoramas.has(link.target)) fail("reference", path, `link ${entity.id}/${link.id} targets an unsupported entity`);
    return result.scene;
  };
  const children = new Map<string, ChildState>();
  const mediaPins = new Map<string, SceneArtifactPin>();
  const totals = { entities: 0, assets: 0, groups: 0, links: 0, representations: 0 };
  for (const [index, entry] of requestedChildren.entries()) {
    cancel(); const path = `$request.children[${index}]`, record = asRecord(entry, path);
    keys(record, ["key", "manifest", "media", "aliases"], path);
    const key = identifier(record.key, `${path}.key`);
    if (children.has(key)) fail("collision", `${path}.key`, "repeats a child key");
    const manifestRecord = asRecord(record.manifest, `${path}.manifest`), mediaRecord = asRecord(record.media, `${path}.media`);
    keys(manifestRecord, ["url", "sha256", "sizeBytes", "id", "revision"], `${path}.manifest`);
    keys(mediaRecord, ["url", "sha256", "sizeBytes", "id", "revision", "baseUrl"], `${path}.media`);
    const manifest = { ...pinAt(manifestRecord, `${path}.manifest`), id: identifier(manifestRecord.id, `${path}.manifest.id`), revision: text(manifestRecord.revision, `${path}.manifest.revision`) };
    const media = { ...pinAt(mediaRecord, `${path}.media`), id: identifier(mediaRecord.id, `${path}.media.id`), revision: text(mediaRecord.revision, `${path}.media.revision`), baseUrl: absoluteUrl(mediaRecord.baseUrl, `${path}.media.baseUrl`) };
    const document = parse(read(manifest, "manifestBytes", `${path}.manifest`), `${path}.document`);
    if (document.id !== manifest.id || document.revision !== manifest.revision) fail("drift", `${path}.manifest`, "child ID/revision differs from the pinned manifest");
    const indexDocument = parse(read(media, "mediaIndexBytes", `${path}.media`), `${path}.mediaIndex`);
    keys(indexDocument, ["format", "version", "id", "revision", "files"], `${path}.mediaIndex`);
    if (indexDocument.format !== "foss-earth-scene-media" || indexDocument.version !== 1 || indexDocument.id !== media.id || indexDocument.revision !== media.revision) fail("drift", `${path}.mediaIndex`, "media format/version/ID/revision differs from the release pin");
    const localMedia = new Map<string, SceneArtifactPin>();
    const listedFiles = asArray(indexDocument.files, `${path}.mediaIndex.files`); bounded(listedFiles.length, "files", `${path}.mediaIndex.files`);
    for (const [at, file] of listedFiles.entries()) {
      const filePath = `${path}.mediaIndex.files[${at}]`, fileRecord = asRecord(file, filePath);
      keys(fileRecord, ["url", "sha256", "sizeBytes"], filePath);
      const pin = pinAt(fileRecord, filePath, media.baseUrl);
      if (localMedia.has(pin.url)) fail("collision", filePath, "repeats a file URL within one media release");
      localMedia.set(pin.url, pin);
      read(pin, "fileBytes", filePath); mediaPins.set(pin.url, pin); bounded(mediaPins.size, "files", filePath);
    }
    for (const name of ["entities", "assets", "groups"] as const) {
      totals[name] += asArray(document[name] ?? [], `${path}.document.${name}`).length;
      if (name === "groups") { if (totals.groups > limits.groups + consumedInputGroups) fail("limit", path, "exceeds bounded input groups plus explicit consumption"); }
      else bounded(totals[name], name, path);
    }
    inspectExtensions(document, `${path}.document`);
    for (const [at, asset] of asArray(document.assets, `${path}.document.assets`).entries()) {
      const assetPath = `${path}.document.assets[${at}]`, assetRecord = asRecord(asset, assetPath);
      if (assetRecord.type !== "panorama-image") fail("owner-required", assetPath, "unsupported asset type cannot be discarded during composition");
      inspectExtensions(assetRecord, assetPath);
      for (const [repAt, rep] of asArray(assetRecord.representations, `${assetPath}.representations`).entries()) {
        const repPath = `${assetPath}.representations[${repAt}]`, repRecord = asRecord(rep, repPath);
        if (typeof repRecord.projection !== "string" || !owners.has(repRecord.projection)) fail("owner-required", repPath, "a public representation composition owner is required");
        inspectExtensions(repRecord, repPath); bounded(++totals.representations, "representations", repPath);
      }
    }
    for (const [at, entity] of asArray(document.entities, `${path}.document.entities`).entries()) {
      const entityPath = `${path}.document.entities[${at}]`, entityRecord = asRecord(entity, entityPath);
      inspectExtensions(entityRecord, entityPath);
      // Unknown optional entity payload remains inert and untouched; its private reference structure is not traversed.
      if (entityRecord.type === "panorama") for (const [linkAt, link] of asArray(entityRecord.links ?? [], `${entityPath}.links`).entries()) inspectExtensions(asRecord(link, `${entityPath}.links[${linkAt}]`), `${entityPath}.links[${linkAt}]`);
    }
    for (const [at, group] of asArray(document.groups ?? [], `${path}.document.groups`).entries()) inspectExtensions(asRecord(group, `${path}.document.groups[${at}]`), `${path}.document.groups[${at}]`);
    const validated = validate(document, media.baseUrl, `${path}.document`);
    totals.links += [...validated.panoramas.values()].reduce((sum, panorama) => sum + panorama.links.length, 0); bounded(totals.links, "links", path);
    const ids: ChildState["ids"] = { assets: new Map(), entities: new Map(), groups: new Map() };
    const context: SceneCompositionChildContext = { key, baseUrl: media.baseUrl, resolveId(kind, id) { const output = ids[kind].get(id); return output ?? fail("reference", `${path}.${kind}`, `unknown ${kind} ID ${id}`); } };
    children.set(key, { pin: { key, manifest, media, ...(record.aliases === undefined ? {} : { aliases: record.aliases as SceneCompositionChild["aliases"] }) }, document, validated, media: localMedia, ids, context });
  }
  const consumedGroups = new Map<string, string>();
  const replacementIds = new Set<string>();
  const childReferenceKey = (value: unknown, path: string): { key: string; child: ChildState; id: string } => {
    const record = asRecord(value, path); keys(record, ["child", "id"], path);
    const child = children.get(identifier(record.child, `${path}.child`)) ?? fail("reference", path, "unknown child");
    const id = identifier(record.id, `${path}.id`); return { key: `${child.pin.key}/${id}`, child, id };
  };
  for (const [at, value] of replacementRequests.entries()) {
    const path = `$request.groupReplacements[${at}]`, record = asRecord(value, path), group = asRecord(record.group, `${path}.group`);
    const outputId = identifier(group.id, `${path}.group.id`);
    if (replacementIds.has(outputId)) fail("collision", `${path}.group.id`, "repeats a composed group ID"); replacementIds.add(outputId);
    const sourceMembers = new Set<string>();
    for (const [index, ref] of asArray(record.consume, `${path}.consume`).entries()) {
      const source = childReferenceKey(ref, `${path}.consume[${index}]`);
      const original = source.child.validated.groups.find(entry => entry.id === source.id);
      if (!original) fail("reference", `${path}.consume[${index}]`, "names no child group");
      if (consumedGroups.has(source.key)) fail("collision", `${path}.consume[${index}]`, "a child group can be consumed only once");
      consumedGroups.set(source.key, outputId);
      for (const id of original.members) sourceMembers.add(`${source.child.pin.key}/${id}`);
    }
    const members = new Set<string>();
    for (const [index, ref] of asArray(record.members, `${path}.members`).entries()) {
      const member = childReferenceKey(ref, `${path}.members[${index}]`);
      if (!member.child.validated.entityOrder.includes(member.id)) fail("reference", `${path}.members[${index}]`, "names no child entity");
      if (members.has(member.key)) fail("collision", `${path}.members[${index}]`, "repeats a member"); members.add(member.key);
    }
    if (members.size !== sourceMembers.size || [...sourceMembers].some(key => !members.has(key))) fail("reference", `${path}.members`, "must preserve the complete consumed member union exactly once in authored order");
    if (group.extensions !== undefined && record.contextChild === undefined) fail("owner-required", `${path}.contextChild`, "author an explicit child context for group extension owners");
    if (record.contextChild !== undefined && !children.has(identifier(record.contextChild, `${path}.contextChild`))) fail("reference", `${path}.contextChild`, "unknown child context");
  }
  const aliases: SceneCompositionResult["provenance"]["aliases"][number][] = [];
  for (const kind of ["assets", "entities", "groups"] as const) {
    const occupied = new Map<string, string>();
    for (const child of children.values()) {
      const configuration = child.pin.aliases === undefined ? {} : asRecord(child.pin.aliases, `$children.${child.pin.key}.aliases`);
      keys(configuration, ["assets", "entities", "groups"], `$children.${child.pin.key}.aliases`);
      const configured = configuration[kind] === undefined ? {} : asRecord(configuration[kind], `$children.${child.pin.key}.aliases.${kind}`);
      const records = asArray(child.document[kind] ?? [], `$children.${child.pin.key}.${kind}`).map((value, index) => asRecord(value, `$children.${child.pin.key}.${kind}[${index}]`));
      for (const originalId of Object.keys(configured)) if (!records.some(record => record.id === originalId)) fail("reference", `$children.${child.pin.key}.aliases.${kind}.${originalId}`, "alias names no child record");
      for (const record of records) {
        const originalId = record.id as string;
        const replacement = kind === "groups" ? consumedGroups.get(`${child.pin.key}/${originalId}`) : undefined;
        const outputId = replacement ?? (own(configured, originalId) ? identifier(configured[originalId], `$children.${child.pin.key}.aliases.${kind}.${originalId}`) : originalId);
        if (replacement && own(configured, originalId) && configured[originalId] !== replacement) fail("collision", `$children.${child.pin.key}.aliases.${kind}.${originalId}`, "alias contradicts explicit group replacement");
        if (replacement) { child.ids[kind].set(originalId, outputId); aliases.push({ child: child.pin.key, kind, originalId, outputId }); continue; }
        if (kind === "groups" && replacementIds.has(outputId)) fail("collision", `$children.${child.pin.key}.groups.${originalId}`, "composed group ID collides with an unconsumed child group");
        if (kind === "entities" && record.type !== "panorama" && outputId !== originalId) fail("owner-required", `$children.${child.pin.key}.entities.${originalId}`, "an inert unknown entity cannot be aliased without its reference owner");
        if (occupied.has(outputId)) fail("collision", `$children.${child.pin.key}.${kind}.${originalId}`, `output ID ${outputId} collides with ${occupied.get(outputId)}; author explicit reversible aliases`);
        occupied.set(outputId, `${child.pin.key}/${originalId}`); child.ids[kind].set(originalId, outputId);
        aliases.push({ child: child.pin.key, kind, originalId, outputId });
      }
    }
  }
  const crossLinks = asArray(request.links ?? [], "$request.links"); bounded(crossLinks.length, "links", "$request.links");
  for (const [at, link] of crossLinks.entries()) {
    const record = asRecord(link, `$request.links[${at}]`); keys(record, ["from", "to", "link", "consume", "insert"], `$request.links[${at}]`);
    const linkRecord = asRecord(record.link, `$request.links[${at}].link`);
    if (own(linkRecord, "externalDestination")) fail("invalid-request", `$request.links[${at}].link.externalDestination`, "mapped cross-child links are local in the composed scene");
    if (own(linkRecord, "target")) fail("invalid-request", `$request.links[${at}].link.target`, "use the explicit to reference");
    inspectExtensions(linkRecord, `$request.links[${at}].link`);
  }
  const extensionStates = new Map<string, unknown>(), documentExtensions: ObjectRecord = {};
  for (const name of [...neededExtensions].sort()) {
    const owner = extensions.get(name)!;
    const entries = [...children.values()].filter(child => isRecord(child.document.extensions) && own(child.document.extensions, name)).map(child => ({ value: (child.document.extensions as ObjectRecord)[name] as ObjectRecord, path: `$children.${child.pin.key}.extensions.${name}`, child: child.context }));
    cancel(); const result = owner.composeDocument(entries, { limits, signal: options.signal }); cancel();
    if (result.document !== undefined) Object.defineProperty(documentExtensions, name, { value: clone(result.document, `$composed.extensions.${name}`), enumerable: true });
    extensionStates.set(name, result.state);
  }
  const rewriteExtensions = (record: ObjectRecord, scope: Parameters<SceneCompositionExtensionOwner["rewrite"]>[1]["scope"], child: ChildState, path: string): void => {
    if (record.extensions === undefined) return;
    const rewritten: ObjectRecord = {};
    for (const [name, value] of Object.entries(asRecord(record.extensions, `${path}.extensions`))) {
      const owner = extensions.get(name) ?? fail("owner-required", path, `missing extension owner ${name}`);
      cancel(); const output = owner.rewrite(asRecord(value, `${path}.extensions.${name}`), { scope, path: `${path}.extensions.${name}`, child: child.context, state: extensionStates.get(name), record }); cancel();
      Object.defineProperty(rewritten, name, { value: clone(output, `${path}.extensions.${name}`), enumerable: true });
    }
    record.extensions = rewritten;
  };
  const fileChildren = new Map<string, Set<string>>();
  let fileReferences = 0;
  const verifyFiles = (scene: ValidatedScene, declared: ReadonlyMap<string, SceneArtifactPin>, key: string): void => {
    const note = (url: string, path: string) => {
      cancel(); bounded(++fileReferences, "fileReferences", path);
      const canonicalUrl = absoluteUrl(url, path);
      if (canonicalUrl !== url || !declared.has(url)) fail("media", path, `${url} is not declared by this pinned media release`);
      const users = fileChildren.get(url) ?? new Set<string>(); if (key !== "$composed") users.add(key); fileChildren.set(url, users);
    };
    const report = checkSceneFiles(scene, url => verified.get(url)?.bytes ?? null, {
      representations: [...owners.values()].map(owner => ({
        ...owner,
        *files(record) { for (const file of owner.files(record)) { note(file.url, `$.assets.${record.id}`); yield file; } },
        *groups(record) { for (const group of owner.groups?.(record) ?? []) { cancel(); bounded(++fileReferences, "fileReferences", `$.assets.${record.id}.groups`); yield group; } },
      })),
      *extensionFiles(value) { for (const name of neededExtensions) for (const file of extensions.get(name)!.files?.(value) ?? []) { note(file.file.url, file.path); yield file; } },
    });
    if (report.problems.length) fail("media", `$children.${key}`, report.problems.map(problem => `${problem.path}: ${problem.message}`).join("; "));
    for (const name of neededExtensions) for (const problem of extensions.get(name)!.verifyFiles?.(scene, url => {
      note(url, `$extensions.${name}`); return verified.get(url)?.bytes ?? null;
    }, { limits, signal: options.signal }) ?? []) {
      fail("media", `$extensions.${name}`, `${problem.path}: ${problem.message}`);
    }
  };
  for (const child of children.values()) verifyFiles(child.validated, child.media, child.pin.key);
  const assets: ObjectRecord[] = [], entityRecords = new Map<string, ObjectRecord>(), groupRecords = new Map<string, ObjectRecord>();
  const externalDestinations = new Map<string, ObjectRecord>();
  for (const child of children.values()) for (const value of asArray(child.document.externalDestinations ?? [], "$child.externalDestinations")) {
    const record = clone(value, "$composed.externalDestination"), prior = externalDestinations.get(record.id as string);
    if (prior && JSON.stringify(prior) !== JSON.stringify(record)) fail("collision", "$child.externalDestinations", "conflicting declared external destination IDs");
    externalDestinations.set(record.id as string, record);
  }
  const assetProvenance: SceneCompositionResult["provenance"]["assets"][number][] = [];
  for (const child of children.values()) {
    for (const value of asArray(child.document.assets, "$child.assets")) {
      const raw = asRecord(value, "$child.assets[]"), asset = clone(raw, "$composed.asset"), originalId = raw.id as string;
      asset.id = child.context.resolveId("assets", originalId);
      asset.attribution = child.validated.assets.get(originalId)!.attribution;
      asset.representations = asArray(raw.representations, "$child.asset.representations").map((value, index) => {
        const record = asRecord(value, "$child.representation"), path = `$children.${child.pin.key}.assets.${originalId}.representations[${index}]`;
        const owner = owners.get(record.projection as string)!;
        cancel(); const published = clone(owner.compose(clone(record, path) as unknown as ImageRepresentation, { path, child: child.context }), path); cancel();
        for (const field of ["id", "role", "projection", "mimeType", "encodedBytes"]) if (published[field] !== record[field]) fail("drift", `${path}.${field}`, "representation composition changed authored identity/bytes");
        if (JSON.stringify(canonical(published.extensions ?? {}, path)) !== JSON.stringify(canonical(record.extensions ?? {}, path))) fail("drift", `${path}.extensions`, "representation owner must preserve opaque extensions for their own composition hook");
        rewriteExtensions(published, "representation", child, path); return published;
      });
      rewriteExtensions(asset, "asset", child, `$children.${child.pin.key}.assets.${originalId}`); assets.push(asset);
      assetProvenance.push({ child: child.pin.key, originalId, outputId: asset.id as string, mediaId: child.pin.media.id, mediaRevision: child.pin.media.revision, mediaIndexSha256: child.pin.media.sha256 });
    }
    for (const value of asArray(child.document.entities, "$child.entities")) {
      const entity = clone(value, "$composed.entity"), originalId = entity.id as string; entity.id = child.context.resolveId("entities", originalId);
      if (entity.type === "panorama") {
        entity.assetId = child.context.resolveId("assets", entity.assetId as string);
        const marker = asRecord(entity.marker, "$child.marker");
        // Materialize only the inherited envelope style; child pose/unknown height stay authored.
        if (child.document.markerStyle !== undefined) marker.style = { ...asRecord(child.document.markerStyle, "$child.markerStyle"), ...(marker.style === undefined ? {} : asRecord(marker.style, "$child.marker.style")) };
        entity.links = asArray(entity.links ?? [], "$child.links").map(value => {
          const link = clone(value, "$composed.link"); if (!link.externalDestination) link.target = child.context.resolveId("entities", link.target as string);
          rewriteExtensions(link, "link", child, `$children.${child.pin.key}.entities.${originalId}.links.${link.id}`); return link;
        });
      }
      rewriteExtensions(entity, "entity", child, `$children.${child.pin.key}.entities.${originalId}`); entityRecords.set(entity.id as string, entity);
    }
    for (const value of asArray(child.document.groups ?? [], "$child.groups")) {
      const group = clone(value, "$composed.group"), originalId = group.id as string;
      if (consumedGroups.has(`${child.pin.key}/${originalId}`)) continue;
      group.id = child.context.resolveId("groups", originalId);
      group.members = asArray(group.members, "$child.group.members").map(id => child.context.resolveId("entities", id as string));
      rewriteExtensions(group, "group", child, `$children.${child.pin.key}.groups.${originalId}`); groupRecords.set(group.id as string, group);
    }
  }
  const reference = (value: unknown, kind: SceneCompositionIdKind, path: string, panorama = false): { id: string; child: ChildState } => {
    const record = asRecord(value, path); keys(record, ["child", "id"], path);
    const child = children.get(record.child as string) ?? fail("reference", path, "unknown child");
    const id = child.context.resolveId(kind, identifier(record.id, `${path}.id`));
    if (panorama && !child.validated.panoramas.has(record.id as string)) fail("reference", path, "must refer to a supported panorama");
    return { id, child };
  };
  const linkMappings: SceneCompositionResult["provenance"]["linkMappings"][number][] = [];
  const editedLinks = new Set<string>();
  for (const [at, value] of crossLinks.entries()) {
    const path = `$request.links[${at}]`, record = asRecord(value, path), from = reference(record.from, "entities", `${path}.from`, true), to = reference(record.to, "entities", `${path}.to`, true);
    const link = clone(record.link, `${path}.link`), id = identifier(link.id, `${path}.link.id`);
    const entity = entityRecords.get(from.id)!, links = asArray(entity.links, "$composed.links");
    const editKey = `${from.id}/${id}`; if (editedLinks.has(editKey)) fail("collision", path, "contradictory/repeated link edits"); editedLinks.add(editKey);
    let position = links.length;
    if (record.consume !== undefined) {
      const consume = identifier(record.consume, `${path}.consume`);
      if (consume !== id) fail("collision", `${path}.consume`, "must retain the consumed link identity");
      const sourceId = asRecord(record.from, `${path}.from`).id as string;
      const raw = from.child.validated.panoramas.get(sourceId)!.links.find(entry => entry.id === consume);
      if (!raw?.externalDestination) fail("reference", `${path}.consume`, "must name an existing declared external link");
      const destination = from.child.validated.externalDestinations?.get(raw.externalDestination);
      if (!destination || destination.sceneId !== to.child.pin.manifest.id || raw.target !== asRecord(record.to, `${path}.to`).id) fail("reference", `${path}.to`, "must map the original declared destination and named panorama");
      const { target: _target, externalDestination: _external, ...metadata } = raw; void _target; void _external;
      if (JSON.stringify(canonical(metadata, path)) !== JSON.stringify(canonical(link, path))) fail("drift", `${path}.link`, "must preserve the consumed link label/direction/arrival/extensions");
      position = links.findIndex(entry => asRecord(entry, path).id === consume);
      if (position < 0) fail("reference", `${path}.consume`, "consumed link is no longer present"); links.splice(position, 1);
    }
    if (links.some(existing => asRecord(existing, path).id === id)) fail("collision", `${path}.link.id`, "repeats a link ID in the source entity");
    if (record.insert !== undefined) {
      const insertion = asRecord(record.insert, `${path}.insert`);
      keys(insertion, ["before", "after", "index"], `${path}.insert`);
      if (Object.keys(insertion).length !== 1) fail("invalid-request", `${path}.insert`, "author exactly one insertion mode");
      if (insertion.index !== undefined) {
        if (!Number.isSafeInteger(insertion.index) || (insertion.index as number) < 0 || (insertion.index as number) > links.length) fail("reference", `${path}.insert.index`, "must be a bounded insertion position"); position = insertion.index as number;
      } else {
        const key = insertion.before !== undefined ? "before" : "after", anchor = identifier(insertion[key], `${path}.insert.${key}`);
        const matches = links.flatMap((entry, index) => asRecord(entry, path).id === anchor ? [index] : []);
        if (matches.length !== 1) fail("reference", `${path}.insert.${key}`, "anchor is missing or ambiguous"); position = matches[0]! + (key === "after" ? 1 : 0);
      }
    }
    link.target = to.id; rewriteExtensions(link, "link", from.child, `${path}.link`); links.splice(position, 0, link);
    linkMappings.push({ child: from.child.pin.key, entityId: asRecord(record.from, path).id as string, linkId: id, to: record.to as SceneChildReference, consumed: record.consume !== undefined });
  }
  bounded([...entityRecords.values()].reduce((sum, entity) => sum + (Array.isArray(entity.links) ? entity.links.length : 0), 0), "links", "$composed.links");
  const groupReplacements: SceneCompositionResult["provenance"]["groupReplacements"][number][] = [];
  for (const [at, value] of replacementRequests.entries()) {
    const path = `$request.groupReplacements[${at}]`, record = asRecord(value, path), group = clone(record.group, `${path}.group`);
    group.members = asArray(record.members, `${path}.members`).map((value, index) => reference(value, "entities", `${path}.members[${index}]`).id);
    const first = childReferenceKey(asArray(record.consume, path)[0], path).child;
    const context = record.contextChild === undefined ? first : children.get(record.contextChild as string)!;
    rewriteExtensions(group, "group", context, `${path}.group`); groupRecords.set(group.id as string, group);
    groupReplacements.push({ outputId: group.id as string, consumed: record.consume as SceneChildReference[], members: record.members as SceneChildReference[] });
  }
  bounded(groupRecords.size, "groups", "$composed.groups");
  const ordered = (value: unknown, kind: "entities" | "groups", records: Map<string, ObjectRecord>, path: string): ObjectRecord[] => {
    const order = asArray(value, path); bounded(order.length, kind, path); const seen = new Set<string>();
    const result = order.map((entry, index) => { const location = `${path}[${index}]`;
      const record = asRecord(entry, location);
      let id: string;
      if (kind === "groups" && own(record, "composed")) { keys(record, ["composed"], location); id = identifier(record.composed, `${location}.composed`); if (!replacementIds.has(id)) fail("reference", location, "unknown composed group"); }
      else { if (kind === "groups") { const ref = childReferenceKey(entry, location); if (consumedGroups.has(ref.key)) fail("reference", location, "use the explicit composed group reference for consumed groups"); } id = reference(entry, kind, location).id; }
      if (!records.has(id)) fail("reference", location, "ordered record does not exist"); if (seen.has(id)) fail("collision", `${path}[${index}]`, "repeats an ordered record"); seen.add(id); return records.get(id)!; });
    if (seen.size !== records.size) fail("reference", path, "must include every child record exactly once");
    return result;
  };
  const seenDefaultGroups = new Set<string>();
  const defaultGroups = [...children.values()].flatMap(child => [...child.ids.groups.keys()].flatMap(id => {
    const replacement = consumedGroups.get(`${child.pin.key}/${id}`);
    if (!replacement) return [{ child: child.pin.key, id } as SceneCompositionGroupReference];
    if (seenDefaultGroups.has(replacement)) return []; seenDefaultGroups.add(replacement); return [{ composed: replacement } as SceneCompositionGroupReference];
  }));
  const requiredExtensions = [...new Set([...children.values()].flatMap(child => asArray(child.document.requiredExtensions ?? [], "$child.requiredExtensions") as string[]))].sort();
  const document: ObjectRecord = { format: SCENE_FORMAT, version: SCENE_FORMAT_VERSION, id: request.id, revision: request.revision, title: request.title,
    ...(externalDestinations.size ? { externalDestinations: [...externalDestinations.values()] } : {}),
    assets, entities: ordered(request.entityOrder, "entities", entityRecords, "$request.entityOrder"), groups: ordered(request.groupOrder ?? defaultGroups, "groups", groupRecords, "$request.groupOrder"),
    ...(request.initialPanorama === undefined ? {} : { initialPanorama: reference(request.initialPanorama, "entities", "$request.initialPanorama", true).id }),
    ...(request.overview === undefined ? {} : { overview: request.overview }),
    ...(Object.keys(documentExtensions).length ? { extensions: documentExtensions } : {}), ...(requiredExtensions.length ? { requiredExtensions } : {}),
  };
  const finalDocument = clone(document, "$composed");
  const manifest = JSON.stringify(finalDocument, null, 2) + "\n", bytes = utf8(manifest); bounded(bytes.byteLength, "manifestBytes", "$composed");
  // All leaf media is absolute by now. A sentinel base exposes incomplete owner rebasing.
  const validated = validate(finalDocument, "https://composition.invalid/parent/scene.json", "$composed");
  verifyFiles(validated, mediaPins, "$composed"); cancel();
  return { document: finalDocument as unknown as SceneDocument, manifest, sha256: hash(bytes, "$composed"), sizeBytes: bytes.byteLength,
    provenance: { requestSha256: hash(utf8(JSON.stringify(request)), "$request"), children: [...children.values()].map(child => child.pin), aliases, groupReplacements, linkMappings, assets: assetProvenance,
      files: [...fileChildren.keys()].sort().map(url => ({ ...mediaPins.get(url)!, children: [...fileChildren.get(url)!].sort() })),
      verifiedMediaFiles: mediaPins.size, verifiedInputBytes, declaredFileReferences: fileReferences,
      warnings: [...children.values()].flatMap(child => child.validated.warnings).concat(validated.warnings) } };
}
