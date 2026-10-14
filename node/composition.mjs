/** Explicit byte inputs only. This adapter adds standard SHA-256 and public leaf bindings. */
import { createHash } from "node:crypto";
import { validateViewerAsset } from "@foss-earth/sphere-image";
import { tiledCubeFilesWithLevel } from "@foss-earth/sphere-tiled-cubemap";
import { createNodePreviewSheetsCompositionOwner } from "@foss-earth/preview-sheets/composition-node";
import { builtInSceneHooks } from "./scene-check.mjs";
import { composeSceneDocuments, SceneCompositionError } from "../dist/composition.js";

export function builtInSceneCompositionOwners() {
  return builtInSceneHooks().map(hook => ({
    ...hook,
    compose(record, context) {
      // These public built-in validators return owner-authored records with resolved URLs.
      // No extension resolver runs here, so no transient sheet/runtime field is serialized.
      const result = hook.validate(record, { path: context.path, baseUrl: context.child.baseUrl });
      if (!result.ok) throw new SceneCompositionError("invalid-scene", context.path, result.errors.map(error => error.message).join("; "));
      if (result.warnings.length) throw new SceneCompositionError("invalid-scene", context.path, result.warnings.map(warning => warning.message).join("; "));
      return result.representation;
    },
    ...(hook.projection === "tiled-cube" ? {
      *files(record) { for (const file of tiledCubeFilesWithLevel(record)) yield { ...file, group: String(file.level) }; },
      groups: record => record.levelBytes.map((encodedBytes, level) => ({ id: String(level), fieldPath: `.levelBytes[${level}]`, encodedBytes, filesLabel: `level ${level}'s tiles` })),
    } : {}),
  }));
}

/** Public checked leaf owners. No fixture adapter or sibling source is imported. */
export function builtInSceneCompositionExtensions(options) { return [createNodePreviewSheetsCompositionOwner(options)]; }

/** Does not acquire/read/write anything. Hosts may override the public owner list explicitly. */
export function composeScenes(request, options) {
  return composeSceneDocuments(request, {
    ...options,
    extensions: options.extensions ?? builtInSceneCompositionExtensions(options.previewSheets),
    sha256: bytes => createHash("sha256").update(bytes).digest("hex"),
    representations: options.representations ?? builtInSceneCompositionOwners(),
    validateImageAsset: options.validateImageAsset ?? validateViewerAsset,
  });
}
