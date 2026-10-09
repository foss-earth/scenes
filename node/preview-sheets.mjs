/** Scene-owned local document composition using the public preview-sheet packer. */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addPreviewSheets, SHEET_PIXELS, sheetsOf } from "@foss-earth/preview-sheets/preparation";
import { cubeRepresentation } from "@foss-earth/cubemap";

const within = (folder, file) => {
  const relative = path.relative(folder, file);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

/** Original local file/manifest behavior; no network, renderer or application instance. */
export function buildScenePreviewSheets(manifestPath, options = {}) {
  const folder = realpathSync(path.dirname(path.resolve(manifestPath)));
  const manifest = realpathSync(path.resolve(manifestPath));
  if (!within(folder, manifest)) throw new Error(`${manifestPath} is outside the scene's folder`);
  const localFile = url => {
    if (typeof url !== "string" || /^[a-z][a-z0-9+.-]*:/i.test(url)) throw new Error(`${url} is outside the scene's folder`);
    const file = path.resolve(folder, decodeURIComponent(url));
    if (!within(folder, file) || (existsSync(file) && !within(folder, realpathSync(file)))) throw new Error(`${url} is outside the scene's folder`);
    let ancestor = path.dirname(file);
    while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
    if (!within(folder, realpathSync(ancestor))) throw new Error(`${url} is outside the scene's folder`);
    return file;
  };
  const inputs = new Set();
  const before = JSON.parse(readFileSync(manifest, "utf8"));
  // Protect even unselected original cubes through the public leaf enumerator.
  // Malformed/foreign declarations retain the packer's existing handling.
  for (const asset of before.assets ?? []) for (const representation of asset.representations ?? []) {
    if (representation.projection !== cubeRepresentation.projection) continue;
    let originals;
    try { originals = cubeRepresentation.files(representation); }
    catch { continue; } // An optional unselected record does not turn this tool into a validator.
    for (const original of originals) {
      try { const file = localFile(original.url); inputs.add(existsSync(file) ? realpathSync(file) : file); }
      catch { /* Foreign originals are never local cleanup targets. */ }
    }
  }
  const result = addPreviewSheets(before, {
    faceSize: options.faceSize,
    quality: options.quality ?? 80,
    maxPixels: options.maxPixels ?? SHEET_PIXELS,
    read(url) {
      const file = localFile(url);
      if (!existsSync(file)) return null;
      inputs.add(realpathSync(file));
      return readFileSync(file);
    },
  });
  // The packer returns relative media names. Validate existing parent symlinks
  // before any write, even when the final generated file does not exist yet.
  const outputs = result.files.map(file => {
    const target = localFile(file.url);
    const actual = existsSync(target) ? realpathSync(target) : target;
    if (actual === manifest || inputs.has(actual)) throw new Error(`${file.url} would replace the manifest or an original face file`);
    return { ...file, target };
  });
  const obsolete = [];
  for (const sheet of sheetsOf(before)) {
    if (result.files.some(file => file.url === sheet.url)) continue;
    try {
      const target = localFile(sheet.url), actual = existsSync(target) ? realpathSync(target) : target;
      if (actual !== manifest && !inputs.has(actual)) obsolete.push(target);
    } catch { /* External records are never removed. */ }
  }
  for (const file of obsolete) rmSync(file, { force: true });
  for (const { target, bytes } of outputs) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  writeFileSync(manifest, `${JSON.stringify(result.document, null, 2)}\n`);
  return result;
}
