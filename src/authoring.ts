/** Assemble prepared panorama fragments; image owners and the host validate pixels/representations. */
import type { SceneDocument } from './format.js';

export interface AddPreparedPanoramaOptions {
  id: string;
  title: string;
  latitudeDeg: number;
  longitudeDeg: number;
  description?: string;
  /** Base for the fragment's URLs, including any --url-prefix used during preparation. */
  mediaBaseUrl: string;
  /** Resolve existing image/sheet URLs when exporting a draft at another location. */
  sceneBaseUrl?: string;
  groupId?: string;
  initial?: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`${label} must use letters, numbers, dots, underscores or hyphens.`);
}
function baseUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('A base URL must be an http(s) address without credentials, query or fragment.');
  return url.href;
}
function imageUrl(value: unknown, base: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('An image URL must be nonempty text.');
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Image URLs must use http(s) without credentials.');
  return url.href;
}
function rebaseAsset(asset: Record<string, unknown>, base: string): void {
  if (!Array.isArray(asset.representations)) throw new Error('A prepared asset needs representations.');
  for (const value of asset.representations) {
    const representation = record(value, 'Representation');
    if (representation.url !== undefined) representation.url = imageUrl(representation.url, base);
    if (representation.faces !== undefined) {
      const faces = record(representation.faces, 'Cube faces');
      for (const key of Object.keys(faces)) faces[key] = imageUrl(faces[key], base);
    }
  }
}

/**
 * Immutable assembly only: no fetch, file writes, invented height or links.
 * Validate the result using the host's normal representation/extension catalogue
 * before preview/publication. The Node CLI performs that full validation.
 */
export function addPreparedPanorama(input: unknown, prepared: unknown, options: AddPreparedPanoramaOptions): SceneDocument {
  const scene = record(structuredClone(input), 'Scene');
  const fragment = record(structuredClone(prepared), 'Prepared fragment');
  if (scene.format !== 'foss-earth-scene' || scene.version !== 1 || !Array.isArray(scene.assets) || !Array.isArray(scene.entities)) throw new Error('Expected a version-one FOSS Earth scene with assets and entities.');
  identifier(options.id, 'Panorama ID');
  if (!options.title?.trim()) throw new Error('A panorama title is required.');
  if (!Number.isFinite(options.latitudeDeg) || options.latitudeDeg < -90 || options.latitudeDeg > 90 || !Number.isFinite(options.longitudeDeg) || options.longitudeDeg < -180 || options.longitudeDeg > 180) throw new Error('Enter valid latitude and longitude in degrees.');
  const asset = record(fragment.asset, 'Prepared asset');
  identifier(asset.id, 'Asset ID');
  if (asset.type !== 'panorama-image' || typeof asset.revision !== 'string' || !asset.revision || !Array.isArray(asset.representations) || !asset.representations.length) throw new Error('Expected an asset.fragment.json from panorama preparation.');
  const attribution = record(asset.attribution, 'Image credit');
  if (typeof attribution.text !== 'string' || !attribution.text.trim()) throw new Error('A photograph credit is required.');
  const pose = record(fragment.imagePose, 'Image pose');
  if (!['headingDeg', 'pitchDeg', 'rollDeg'].every(key => typeof pose[key] === 'number' && Number.isFinite(pose[key]))) throw new Error('The prepared fragment needs a finite heading, pitch and roll.');
  if (scene.assets.some(value => record(value, 'Scene asset').id === asset.id)) throw new Error(`Asset ID already exists: ${asset.id}`);
  if (scene.entities.some(value => record(value, 'Scene entity').id === options.id)) throw new Error(`Panorama ID already exists: ${options.id}`);
  if (options.sceneBaseUrl) {
    const base = baseUrl(options.sceneBaseUrl);
    for (const value of scene.assets) rebaseAsset(record(value, 'Scene asset'), base);
    const extensions = scene.extensions as Record<string, { sheets?: Record<string, unknown>[] }> | undefined;
    for (const sheet of extensions?.['foss-earth.preview-sheets']?.sheets ?? []) sheet.url = imageUrl(sheet.url, base);
  }
  const mediaBase = baseUrl(options.mediaBaseUrl);
  if (!new URL(mediaBase).pathname.endsWith('/')) throw new Error('Media base URL must be a directory ending with /.');
  rebaseAsset(asset, mediaBase);
  scene.assets.push(asset);
  scene.entities.push({
    id: options.id, type: 'panorama', assetId: asset.id, title: options.title.trim(),
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    capture: { latitudeDeg: options.latitudeDeg, longitudeDeg: options.longitudeDeg, height: null },
    imagePose: pose,
    marker: { mode: 'ground-relative', eastM: 0, northM: 0, offsetM: 4 },
    links: [],
    extensions: { 'foss-earth.authoring': { placement: 'User-entered coordinates; capture height is unknown.' } },
  });
  if (options.groupId) {
    identifier(options.groupId, 'Group ID');
    if (scene.groups === undefined) scene.groups = [];
    if (!Array.isArray(scene.groups)) throw new Error('Scene groups must be an array.');
    let group = scene.groups.map(value => record(value, 'Group')).find(value => value.id === options.groupId);
    if (!group) { group = { id: options.groupId, title: options.groupId, members: [] }; scene.groups.push(group); }
    if (!Array.isArray(group.members)) throw new Error('Group members must be an array.');
    group.members.push(options.id);
  }
  if (options.initial || scene.entities.length === 1) scene.initialPanorama = options.id;
  scene.revision = `import-${options.id}-${asset.revision}`;
  return scene as unknown as SceneDocument;
}
