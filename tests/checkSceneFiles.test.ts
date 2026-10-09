import { describe, expect, it, vi } from "vitest";
import { checkSceneFiles, validateScene, type SceneRepresentationFileHook } from "../src/index.js";
import { fixtureDocument, fixtureOptions } from "./fixtures.js";

function png(): Uint8Array {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, 4); view.setUint32(20, 2);
  return bytes;
}
function validated() {
  const document = fixtureDocument();
  for (const asset of document.assets as Array<{ representations: Array<{ encodedBytes: number }> }>) asset.representations[0].encodedBytes = 66;
  const result = validateScene(document, fixtureOptions);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.scene;
}
const file = { url: "https://neutral.invalid/shared.png", mimeType: "image/png" as const, width: 4, height: 2 };
const owner: SceneRepresentationFileHook = {
  projection: "fixture",
  files: function* () { yield { ...file, group: "opaque" }; yield { ...file, group: "opaque" }; },
  filePath: (_record, _file, index) => `.pages[${index}]`,
  groups: () => [{ id: "opaque", fieldPath: ".pageBytes", encodedBytes: 66, filesLabel: "the authored pages" }],
};

describe("pure caller-supplied scene file traversal", () => {
  it("keeps the owner's distinct fields and counts repeated declarations of one URL", () => {
    const scene = validated(), read = vi.fn(() => png());
    const report = checkSceneFiles(scene, read, { representations: [owner] });
    expect(report.problems).toEqual([]);
    expect(report.files).toBe(scene.assets.size * 2);
    expect(report.bytes).toBe(scene.assets.size * 66);
    expect(read).toHaveBeenCalledTimes(scene.assets.size * 2);
    const missing = checkSceneFiles(scene, () => null, { representations: [owner] });
    expect(missing.problems.map(problem => problem.path)).toEqual([...scene.assets.keys()].flatMap(id => [
      `$.assets[${id}].representations[fixture].pages[0]`, `$.assets[${id}].representations[fixture].pages[1]`,
    ]));
  });

  it("reports owner group totals only when its declared files are complete", () => {
    const badGroup = { ...owner, groups: () => [{ id: "opaque", fieldPath: ".pageBytes", encodedBytes: 67, filesLabel: "the authored pages" }] };
    const full = checkSceneFiles(validated(), () => png(), { representations: [badGroup] });
    expect(full.problems.every(problem => problem.path.endsWith(".pageBytes") && problem.message === "declares 67 bytes; the authored pages hold 66")).toBe(true);
    let count = 0;
    const incomplete = checkSceneFiles(validated(), () => ++count % 2 ? png() : null, { representations: [badGroup] });
    expect(incomplete.problems.every(problem => problem.path.endsWith(".pages[1]"))).toBe(true);
  });

  it("checks opaque extension files only through the supplied owner and never makes a request", () => {
    const scene = validated(), read = vi.fn(() => png()), extensionFiles = vi.fn(() => [{ path: "$.extensions.neutral.files[s]", file, encodedBytes: 34 }]);
    const report = checkSceneFiles(scene, read, { representations: [owner], extensionFiles });
    expect(extensionFiles).toHaveBeenCalledWith(scene);
    expect(report.problems).toEqual([{ path: "$.extensions.neutral.files[s].encodedBytes", message: "declares 34 bytes; the file holds 33" }]);
    expect(report.files).toBe(scene.assets.size * 2 + 1);
  });
});
