import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ImageRecordChecker, checkImageRepresentationBase, type RepresentationHooks } from "@foss-earth/images";
import { validateScene, type ValidateSceneOptions } from "../src/index.js";

const baseUrl = "https://scenes.example/neutral/scene.json";
function example(): Record<string, unknown> {
  const document = JSON.parse(readFileSync(new URL("./fixtures/proposal-example.scene.json", import.meta.url), "utf8"));
  // Envelope tests use a supplied test-only representation; real spatial cases
  // remain with their public owner validators and the360 composition fixture.
  for (const asset of document.assets) asset.representations = [{ id: "fixture", role: "preview", projection: "fixture", mimeType: "image/png", encodedBytes: 1 }];
  return document;
}
const fixture: RepresentationHooks = {
  projection: "fixture",
  validate(value, context) {
    const checker = new ImageRecordChecker(), record = checker.record(value, context.path);
    if (!record) return { ok: false, errors: checker.errors };
    checker.keys(record, context.path, ["id", "role", "projection", "mimeType", "encodedBytes", "extensions"]);
    const common = checkImageRepresentationBase(checker, record, context.path);
    return common && !checker.errors.length ? { ok: true, representation: { ...common, projection: "fixture" }, warnings: [] } : { ok: false, errors: checker.errors };
  }, files: () => [], estimate: () => ({ encoded: 1, decoded: 0, sourceGpu: 0, uploadOutstanding: 0 }),
};
const options: ValidateSceneOptions = { baseUrl, representations: [fixture], validateImageAsset: (asset, { path }) => asset.representations.some(record => record.role === "preview") ? [] : [{ path: `${path}.representations`, message: "Fixture policy requires a complete preview" }] };
const entities = (document: Record<string, unknown>) => document.entities as Record<string, unknown>[];
const assets = (document: Record<string, unknown>) => document.assets as Record<string, unknown>[];

describe("the v1 scene envelope with supplied owners", () => {
  it("keeps references, editorial order, placement, unknown height and north alignment", () => {
    const document = example();
    (entities(document)[0].imagePose as Record<string, unknown>).aligned = false;
    const result = validateScene(document, options); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.scene.entityOrder).toEqual(["garden", "courtyard"]);
    expect(result.scene.groups[0].members).toEqual(["garden", "courtyard"]);
    expect(result.scene.panoramas.get("garden")?.capture.height).toBeNull();
    expect(result.scene.panoramas.get("garden")?.imagePose.aligned).toBe(false);
    expect(result.scene.panoramas.get("courtyard")?.capture.height).toEqual({ meters: 2, datum: "WGS84-ellipsoid", source: "synthetic fixture" });
    expect(result.scene.baseUrl).toBe(baseUrl);
  });
  it("refuses versions and byte/count limits before invoking a representation owner", () => {
    const validate = vi.fn(fixture.validate), registered = { ...options, representations: [{ ...fixture, validate }] };
    expect(validateScene({ ...example(), version: 2, assets: "wrong" }, registered)).toMatchObject({ ok: false, errors: [{ path: "$.version" }] });
    expect(validateScene(example(), { ...registered, limits: { assets: 0 } })).toMatchObject({ ok: false, errors: [{ path: "$.assets" }] });
    expect(validateScene(JSON.stringify(example()), { ...registered, limits: { manifestBytes: 1 } })).toMatchObject({ ok: false, errors: [{ path: "$" }] });
    expect(validate).not.toHaveBeenCalled();
  });
  it("delegates spatial validation and asset support rules exclusively to supplied owners", () => {
    const validate = vi.fn(() => ({ ok: false as const, errors: [{ path: "owner.field", message: "Owner error" }] }));
    const result = validateScene(example(), { ...options, representations: [{ ...fixture, validate }] });
    expect(result.ok).toBe(false); if (!result.ok) expect(result.errors).toContainEqual({ path: "owner.field", message: "Owner error" });
    expect(validate).toHaveBeenCalledTimes(2);
    expect(() => validateScene(example(), { ...options, representations: [fixture, fixture] })).toThrow(/unique/);
  });
  it("skips later projections with a warning while preserving usable representations", () => {
    const document = example(); (assets(document)[0].representations as unknown[]).push({ projection: "future", layout: { unfamiliar: true } });
    const result = validateScene(document, options); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.scene.assets.get("garden-image")?.representations).toHaveLength(1);
    expect(result.scene.warnings[0].message).toMatch(/future.*skipped/);
  });
  it("retains unsupported entities in authored order and disables their links", () => {
    const document = example(); entities(document).splice(1, 0, { id: "future", type: "future-entity" });
    (entities(document)[0].links as unknown[]).push({ id: "later", target: "future", label: "Later" });
    const result = validateScene(document, options); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.scene.entityOrder).toEqual(["garden", "future", "courtyard"]);
    expect(result.scene.unsupported.get("future")?.type).toBe("future-entity");
    expect(result.scene.warnings.some(warning => /listed disabled/.test(warning.message))).toBe(true);
    entities(document)[1].required = true; expect(validateScene(document, options).ok).toBe(false);
  });
  it("reports known-record properties, ranges, duplicate IDs and broken references", () => {
    const document = example();
    (entities(document)[0].capture as Record<string, unknown>).latitudeDeg = 91;
    (entities(document)[0].marker as Record<string, unknown>).height = 4;
    entities(document)[1].id = "garden";
    const result = validateScene(document, options); expect(result.ok).toBe(false); if (!result.ok) expect(result.errors.map(error => error.path)).toEqual(expect.arrayContaining(["$.entities[0].capture.latitudeDeg", "$.entities[0].marker.height", "$.entities[1].id"]));
    const broken = example(); entities(broken)[0].assetId = "missing"; expect(validateScene(broken, options).ok).toBe(false);
  });
  it("keeps unknown extensions inert and invokes only an explicit owner hook", () => {
    const document = example(), validateDocument = vi.fn(() => ({ data: { accepted: true }, warnings: [{ path: "extension", message: "Optional warning" }] }));
    document.extensions = { "example.notes": { data: "inert" } };
    expect(validateScene(document, options).ok).toBe(true); expect(validateDocument).not.toHaveBeenCalled();
    document.requiredExtensions = ["example.notes"]; expect(validateScene(document, options).ok).toBe(false);
    const result = validateScene(document, { ...options, extensionHooks: [{ name: "example.notes", validateDocument }] });
    expect(result.ok).toBe(true); if (!result.ok) return; expect(result.scene.extensionData.get("example.notes")).toEqual({ accepted: true }); expect(validateDocument).toHaveBeenCalledTimes(1);
  });
  it("resolves safe attribution URLs and refuses credentials and non-http protocols", () => {
    const document = example(); (assets(document)[0].attribution as Record<string, unknown>).url = "credits.html";
    const result = validateScene(document, options); expect(result.ok).toBe(true); if (result.ok) expect(result.scene.assets.get("garden-image")?.attribution.url).toBe("https://scenes.example/neutral/credits.html");
    for (const url of ["https://token@example.invalid/credits", "javascript:alert(1)"]) { (assets(document)[0].attribution as Record<string, unknown>).url = url; expect(validateScene(document, options).ok).toBe(false); }
  });
});
