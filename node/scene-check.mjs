/** Local publication check composed from the envelope, common headers and leaf owners. */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { checkSceneFiles as checkDeclaredFiles, validateScene } from "../dist/index.js";
import { createPreviewSheetsExtensionHook } from "@foss-earth/preview-sheets/scene-extension";
import { PREVIEW_SHEETS_EXTENSION, verifyPreviewSheets } from "@foss-earth/preview-sheets/preparation";
import { tiledCubeFilesWithLevel } from "@foss-earth/sphere-tiled-cubemap";
import { createBuiltInRepresentations, validateViewerAsset } from "@foss-earth/sphere-image";

const within = (folder, file) => { const relative = path.relative(folder, file); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
/** Both decoded URL traversal and symlinks must remain inside the supplied local folder. */
export function localSceneReader(folder, baseUrl) {
  const root = realpathSync(folder), served = new URL(".", baseUrl), outside = new Set();
  return { outside, read(url) {
    let file;
    try {
      const parsed = new URL(url);
      if (parsed.origin !== served.origin || !parsed.pathname.startsWith(served.pathname)) { outside.add(url); return null; }
      file = path.resolve(root, decodeURIComponent(parsed.pathname.slice(served.pathname.length)));
      if (!within(root, file)) { outside.add(url); return null; }
      if (!existsSync(file)) return null;
      const actual = realpathSync(file);
      if (!within(root, actual)) { outside.add(url); return null; }
      return statSync(actual).isFile() ? new Uint8Array(readFileSync(actual)) : null;
    } catch { return null; }
  } };
}

/** Existing two-argument API uses the public built-in catalogue; custom owners may supply hooks. */
export function builtInSceneHooks() {
  return createBuiltInRepresentations(() => ({ tileMemoryBytes: 0, responseBytes: 0, requests: 0, waiting: 0, uploadOutstandingBytes: 0 })).map(entry => entry.hooks);
}

export function checkSceneFiles(scene, read, representations = builtInSceneHooks()) {
  return checkDeclaredFiles(scene, read, {
    representations: representations.map(hook => hook.projection === "tiled-cube" ? {
      ...hook,
      files: representation => [...tiledCubeFilesWithLevel(representation)].map(file => ({ ...file, group: String(file.level) })),
      groups: representation => representation.levelBytes.map((encodedBytes, level) => ({
        id: String(level), fieldPath: `.levelBytes[${level}]`, encodedBytes, filesLabel: `level ${level}'s tiles`,
      })),
    } : hook),
    extensionFiles: value => [...(value.extensionData.get(PREVIEW_SHEETS_EXTENSION) ?? new Map()).values()].map(sheet => ({
      path: `$.extensions.${PREVIEW_SHEETS_EXTENSION}.sheets[${sheet.id}]`, file: sheet, encodedBytes: sheet.encodedBytes,
    })),
  });
}

export function checkSceneManifest(manifestPath, options = {}) {
  const baseUrl = new URL(options.baseUrl ?? `https://scene.invalid/${encodeURIComponent(path.basename(manifestPath))}`);
  // Estimates are unused during validation/file checking; explicit values avoid creating runtime budgets.
  const representations = builtInSceneHooks();
  const result = validateScene(readFileSync(manifestPath, "utf8"), { baseUrl: baseUrl.href, representations, validateImageAsset: validateViewerAsset, extensionHooks: [createPreviewSheetsExtensionHook()] });
  const report = { manifest: manifestPath, baseUrl: baseUrl.href, ok: false, errors: [], warnings: [], problems: [], summary: null };
  if (!result.ok) { report.errors = result.errors; return report; }
  const { scene } = result; report.warnings = scene.warnings;
  const reader = localSceneReader(path.dirname(path.resolve(manifestPath)), baseUrl);
  const files = checkSceneFiles(scene, reader.read, representations);
  const sheetRecords = scene.extensionData.get(PREVIEW_SHEETS_EXTENSION) ?? new Map();
  const sheetDocument = {
    extensions: { [PREVIEW_SHEETS_EXTENSION]: { sheets: [...sheetRecords.values()] } },
    assets: [...scene.assets.values()].map(asset => ({ ...asset, representations: asset.representations.map(rep => rep.sheet ? { ...rep, extensions: { ...rep.extensions, [PREVIEW_SHEETS_EXTENSION]: { id: rep.sheet.id, x: rep.sheet.x, y: rep.sheet.y } } } : rep) })),
  };
  const sheets = verifyPreviewSheets(sheetDocument, url => { const bytes = reader.read(url); return bytes ? Buffer.from(bytes) : null; });
  files.problems.push(...sheets.problems.filter(problem => !/ does not exist$/.test(problem.message)), ...scene.warnings.filter(warning => warning.path.includes(`extensions.${PREVIEW_SHEETS_EXTENSION}`)));
  report.problems = files.problems.map(problem => {
    const url = [...reader.outside].find(candidate => problem.message === `${candidate} does not exist`);
    return url ? { path: problem.path, message: `${url} is outside ${new URL(".", baseUrl).href}, so it cannot be read from ${path.dirname(path.resolve(manifestPath))}` } : problem;
  });
  report.summary = { id: scene.id, revision: scene.revision, title: scene.title, manifestBytes: scene.manifestBytes,
    spheres: scene.spheres.size, unsupported: scene.unsupported.size, assets: scene.assets.size, groups: scene.groups.length,
    links: [...scene.spheres.values()].reduce((sum, entity) => sum + entity.links.length, 0),
    files: files.files, mediaBytes: files.bytes, largestFile: files.largestFile, sheets: sheetRecords.size,
    sheetCubes: [...scene.assets.values()].reduce((sum, asset) => sum + asset.representations.filter(rep => !!rep.sheet).length, 0),
    sheetLowestPsnrDb: Number.isFinite(sheets.lowestPsnrDb) ? Math.round(sheets.lowestPsnrDb*10)/10 : null };
  report.ok = report.problems.length === 0; return report;
}
