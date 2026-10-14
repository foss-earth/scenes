/** Tiny authored content using the actual public production Preview composition owner. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodePng } from "@foss-earth/images/node";
import { CUBE_FACE_NAMES } from "@foss-earth/sphere-cubemap/core";
import { PREVIEW_SHEETS_EXTENSION, sheetFaceRectangles } from "@foss-earth/preview-sheets";
import { createNodePreviewSheetsCompositionOwner } from "@foss-earth/preview-sheets/composition-node";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value));
const pin = (url, bytes) => ({ url, sha256: sha256(bytes), sizeBytes: bytes.byteLength });

export function createCompositionFixture() {
  const inputs = new Map(), documents = new Map(), indices = new Map(), media = new Map();
  const faceSize = 8, width = CUBE_FACE_NAMES.length * faceSize, height = faceSize * 2;
  const sheetRgb = new Uint8Array(width * height * 3);
  const sheetUrl = "https://shared.example/immutable/content-r1/shared.png";
  const children = [];
  for (const [row, key] of ["west", "east"].entries()) {
    const prefix = row === 0 ? "a" : "b", baseUrl = `https://media.example/immutable/${key}/media-r1/`;
    const files = new Map(), faces = {}, rectangles = sheetFaceRectangles({ x: 0, y: row * faceSize }, faceSize);
    for (const [index, rectangle] of rectangles.entries()) {
      const rgb = new Uint8Array(faceSize * faceSize * 3).fill(15 + row * 100 + index * 12);
      for (let y = 0; y < faceSize; y++) sheetRgb.set(rgb.subarray(y * faceSize * 3, (y + 1) * faceSize * 3), ((rectangle.y + y) * width + rectangle.x) * 3);
      const relativeUrl = `faces/${rectangle.face}.png`, bytes = encodePng({ width: faceSize, height: faceSize, rgb });
      faces[rectangle.face] = relativeUrl; files.set(new URL(relativeUrl, baseUrl).href, bytes);
    }
    const image = { id: `${prefix}-image`, revision: "image-r1", type: "panorama-image", colorSpace: "srgb", alpha: "opaque", attribution: { text: `Credits ${key}`, license: "CC0-1.0", url: "credits.html" }, representations: [{
      id: "preview", role: "preview", projection: "cube", mimeType: "image/png", faceSize, encodedBytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0), faces,
      extensions: { [PREVIEW_SHEETS_EXTENSION]: { id: "shared-sheet", x: 0, y: row * faceSize } },
    }] };
    const entity = number => ({ id: `${prefix}-${number}`, type: "panorama", assetId: image.id, title: `${key} stop ${number}`, description: `Authored caption ${key}/${number}`,
      capture: { longitudeDeg: row * 10, latitudeDeg: number, height: null }, imagePose: { headingDeg: 17 + row, pitchDeg: 0, rollDeg: 0, aligned: false },
      marker: { mode: "ground-relative", eastM: 1, northM: 2, offsetM: 3 },
      links: number === 1 ? [{ id: "local", target: `${prefix}-2`, label: "Local next", direction: { headingDeg: 25, pitchDeg: 1 }, arrivalView: { headingDeg: 5, pitchDeg: 2, verticalFovDeg: 60 } }] : [] });
    const document = { format: "foss-earth-scene", version: 1, id: `child-${key}`, revision: "scene-r1", title: `${key} title`, assets: [image], entities: [entity(1), entity(2)], groups: [{ id: `${prefix}-group`, title: `${key} group`, members: [`${prefix}-1`, `${prefix}-2`] }], initialPanorama: `${prefix}-1`,
      markerStyle: { hover: { scale: 1.2 + row * 0.1 } }, extensions: { [PREVIEW_SHEETS_EXTENSION]: { sheets: [] } } };
    documents.set(key, document); media.set(key, files);
    children.push({ key, manifest: { id: document.id, revision: document.revision, url: `https://documents.example/immutable/${key}/scene-r1/scene.json` }, media: { id: `media-${key}`, revision: "media-r1", url: `https://documents.example/immutable/${key}/media-r1/index.json`, baseUrl } });
  }
  const sheetBytes = encodePng({ width, height, rgb: sheetRgb });
  for (const child of children) {
    documents.get(child.key).extensions[PREVIEW_SHEETS_EXTENSION].sheets = [{ id: "shared-sheet", revision: sha256(sheetBytes), mimeType: "image/png", width, height, encodedBytes: sheetBytes.length, url: sheetUrl }];
    media.get(child.key).set(sheetUrl, sheetBytes);
    const index = { format: "foss-earth-scene-media", version: 1, id: child.media.id, revision: child.media.revision, files: [...media.get(child.key)].map(([url, bytes]) => pin(url, bytes)) };
    indices.set(child.key, index);
    for (const [url, bytes] of media.get(child.key)) inputs.set(url, bytes);
  }
  const request = { schemaVersion: 1, id: "combined-fixture", revision: "combined-r1", title: "Two authored children", children,
    entityOrder: [{ child: "east", id: "b-2" }, { child: "west", id: "a-1" }, { child: "west", id: "a-2" }, { child: "east", id: "b-1" }],
    groupOrder: [{ child: "east", id: "b-group" }, { child: "west", id: "a-group" }], initialPanorama: { child: "west", id: "a-2" },
    overview: { target: { longitudeDeg: 5, latitudeDeg: 1, height: null }, distanceMeters: 1000, headingDeg: 30, pitchDeg: -40, verticalFovDeg: 60 },
    links: [{ from: { child: "west", id: "a-2" }, to: { child: "east", id: "b-1" }, link: { id: "cross", label: "Authored cross-child next", direction: { headingDeg: 40, pitchDeg: 5 } } },
      { from: { child: "east", id: "b-2" }, to: { child: "west", id: "a-1" }, link: { id: "return", label: "Authored return" } }] };
  const repin = key => {
    const child = children.find(child => child.key === key), bytes = jsonBytes(documents.get(key));
    Object.assign(child.manifest, pin(child.manifest.url, bytes)); inputs.set(child.manifest.url, bytes);
    const indexBytes = jsonBytes(indices.get(key)); Object.assign(child.media, pin(child.media.url, indexBytes)); inputs.set(child.media.url, indexBytes);
  };
  for (const child of children) repin(child.key);
  return { request, inputs, documents, indices, media, repin, sheetUrl, extensions: [createNodePreviewSheetsCompositionOwner()] };
}

/** Executed unchanged through the installed public composition entry, never copied producer source. */
export function assertCompositionResult(result, fixture) {
  const { document, provenance } = result;
  assert.equal(document.format, "foss-earth-scene"); assert.equal(document.version, 1);
  assert.deepEqual(document.entities.map(entity => entity.id), ["b-2", "a-1", "a-2", "b-1"]);
  assert.deepEqual(document.groups.map(group => group.id), ["b-group", "a-group"]);
  assert.equal(document.initialPanorama, "a-2"); assert.deepEqual(document.overview, fixture.request.overview);
  assert.equal(document.assets.length, 2); assert.equal(provenance.verifiedMediaFiles, 13); assert.equal(provenance.files.length, 13);
  assert.deepEqual(provenance.files.find(file => file.url === fixture.sheetUrl).children, ["east", "west"]);
  assert.equal(document.extensions[PREVIEW_SHEETS_EXTENSION].sheets.length, 1);
  assert.equal(document.extensions[PREVIEW_SHEETS_EXTENSION].sheets[0].url, fixture.sheetUrl);
  for (const [index, key] of ["west", "east"].entries()) {
    const asset = document.assets[index], source = fixture.documents.get(key), representation = asset.representations[0];
    assert.equal(asset.revision, source.assets[0].revision); assert.equal(asset.attribution.text, source.assets[0].attribution.text);
    assert.equal(asset.attribution.url, new URL("credits.html", fixture.request.children[index].media.baseUrl).href);
    assert.equal(representation.faces.px, new URL("faces/px.png", fixture.request.children[index].media.baseUrl).href);
    assert.equal("sheet" in representation, false);
    for (const raw of source.entities) {
      const entity = document.entities.find(entity => entity.id === raw.id);
      assert.deepEqual(entity.capture, raw.capture); assert.deepEqual(entity.imagePose, raw.imagePose); assert.equal(entity.description, raw.description);
      assert.deepEqual(entity.marker.style, source.markerStyle);
    }
  }
  assert.equal(document.entities.find(entity => entity.id === "a-2").links[0].target, "b-1");
  assert.equal(document.entities.find(entity => entity.id === "b-2").links[0].target, "a-1");
  assert.equal(document.entities.find(entity => entity.id === "a-1").links[0].target, "a-2");
  assert.equal(sha256(new TextEncoder().encode(result.manifest)), result.sha256);
  assert.equal(new TextEncoder().encode(result.manifest).length, result.sizeBytes);
  assert.ok(result.manifest.endsWith("\n")); assert.deepEqual(provenance.warnings, []);
}
