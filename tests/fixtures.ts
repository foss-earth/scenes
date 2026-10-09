import { readFileSync } from "node:fs";
import { ImageRecordChecker, checkImageRepresentationBase, type RepresentationHooks } from "@foss-earth/images";
import type { ValidateSceneOptions } from "../src/index.js";
export const baseUrl = "https://scenes.example/neutral/scene.json";
export function fixtureDocument(): Record<string, unknown> {
  const document = JSON.parse(readFileSync(new URL("./fixtures/proposal-example.scene.json", import.meta.url), "utf8"));
  for (const asset of document.assets) asset.representations = [{ id: "fixture", role: "preview", projection: "fixture", mimeType: "image/png", encodedBytes: 1 }];
  return document;
}
/** Test-only neutral owner. Real spatial fixtures are exercised through installed format owners. */
export const fixtureHooks: RepresentationHooks = {
  projection: "fixture",
  validate(value, context) {
    const checker = new ImageRecordChecker(), record = checker.record(value, context.path);
    if (!record) return { ok: false, errors: checker.errors };
    checker.keys(record, context.path, ["id", "role", "projection", "mimeType", "encodedBytes", "extensions"]);
    const common = checkImageRepresentationBase(checker, record, context.path);
    return common && !checker.errors.length ? { ok: true, representation: { ...common, projection: "fixture" }, warnings: [] } : { ok: false, errors: checker.errors };
  }, files: () => [], estimate: () => ({ encoded: 1, decoded: 0, sourceGpu: 0, uploadOutstanding: 0 }),
};
export const fixtureOptions: ValidateSceneOptions = { baseUrl, representations: [fixtureHooks], validateImageAsset: (asset, { path }) => asset.representations.some(record => record.role === "preview") ? [] : [{ path: `${path}.representations`, message: "Fixture policy requires a complete preview" }] };
