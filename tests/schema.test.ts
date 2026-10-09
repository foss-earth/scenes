import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeSceneSchema, SCENE_DOCUMENT_PARAMETERS } from "../src/index.js";
const schema = JSON.parse(readFileSync(new URL("../schema/scene-1.json", import.meta.url), "utf8"));
describe("the owner-composed public envelope", () => {
  it("contains no spatial format definitions or built-in preview projection policy", () => {
    expect(schema.$defs.representation.allOf).toBeUndefined(); expect(schema.$defs.panoramaAsset.properties.representations.contains).toBeUndefined();
    expect(Object.keys(schema.$defs).some(key => /cube|tiled|sheet|equirect/i.test(key))).toBe(false);
  });
  it("composes explicit owners without mutating the exported envelope", () => {
    const output = composeSceneSchema(schema, { representations: [{ projection: "fixture", schemaRef: "https://formats.example/fixture.schema.json" }], extensions: [{ name: "fixture.optional", schemaRef: "https://formats.example/extension.json" }] });
    expect((output.$defs as typeof schema.$defs).representation.allOf[0].then.$ref).toBe("https://formats.example/fixture.schema.json");
    expect(schema.$defs.representation.allOf).toBeUndefined();
    expect(() => composeSceneSchema(schema, { representations: [{ projection: "fixture", schemaRef: "a" }, { projection: "fixture", schemaRef: "b" }] })).toThrow(/unique/);
  });
  it("exports only existing document controls with their homes, units, bounds and defaults", () => {
    expect(SCENE_DOCUMENT_PARAMETERS.map(spec => spec.id)).toEqual(["scene.manifestMiB", "scene.entityLimit", "scene.assetLimit", "scene.linkLimit"]);
    for (const spec of SCENE_DOCUMENT_PARAMETERS) { expect(spec.home).toEqual({ tab: "scenes", section: "content", level: "all" }); expect(spec.bounds().min).toBeLessThanOrEqual(spec.default); expect(spec.default).toBeLessThanOrEqual(spec.bounds().max); expect(spec.defaultReason).not.toBe(""); }
  });
});
