import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Scene-owned synthetic document/files only; callers supply the public codec and face order. */
export function createPreviewFixture(folder, { encodePng, faces }) {
  const originals = new Map();
  for (const [index, face] of faces.entries()) {
    const url = `originals/${face}.png`, bytes = encodePng({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(30 + index * 30) });
    originals.set(url, bytes); mkdirSync(path.dirname(path.join(folder, url)), { recursive: true }); writeFileSync(path.join(folder, url), bytes);
  }
  const document = { format: "foss-earth-scene", version: 1, id: "preview-fixture", revision: "host-revision", title: "Synthetic preview fixture", assets: [{ id: "image", revision: "image-r1", type: "panorama-image", colorSpace: "srgb", alpha: "opaque", attribution: { text: "Synthetic pixels", license: "CC0-1.0" }, representations: [{ id: "preview", role: "preview", projection: "cube", mimeType: "image/png", faceSize: 8, encodedBytes: [...originals.values()].reduce((sum, bytes) => sum + bytes.length, 0), faces: Object.fromEntries(faces.map(face => [face, `originals/${face}.png`])) }] }], entities: [] };
  const manifest = path.join(folder, "scene.json"); writeFileSync(manifest, JSON.stringify(document));
  return { manifest, document, originals, save() { writeFileSync(manifest, JSON.stringify(document)); }, read(url) { return readFileSync(path.join(folder, decodeURIComponent(url))); } };
}
