import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tiledCubeFilesWithLevel } from "@foss-earth/sphere-tiled-cubemap";
import { checkSceneFiles, checkSceneManifest, localSceneReader } from "../node/scene-check.mjs";

function png(width, height) {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
const faces = ["px", "nx", "py", "ny", "pz", "nz"];
const cube = () => ({ id: "preview", role: "preview", projection: "cube", mimeType: "image/png", faceSize: 64,
  encodedBytes: 6 * 33, faces: Object.fromEntries(faces.map(face => [face, "https://scene.test/tour/shared.png"])) });
function scene(representations, extensionData = new Map()) {
  return { assets: new Map([["image", { id: "image", representations }]]), extensionData };
}
function scratch() {
  const root = fileURLToPath(new URL("../build/node-check/", import.meta.url));
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, "fixture-"));
}

describe("public owner-composed scene file checks", () => {
  it("keeps each authored face field even when all six URLs are equal", () => {
    const report = checkSceneFiles(scene([cube()]), () => null);
    expect(report.problems.map(problem => problem.path)).toEqual(faces.map(face => `$.assets[image].representations[preview].faces.${face}`));
    expect(report.files).toBe(0);
    expect(report.problems).toHaveLength(6);
  });

  it("counts each declared use of a shared URL and suppresses totals only for incomplete groups", () => {
    const good = checkSceneFiles(scene([cube()]), () => png(64, 64));
    expect(good.problems).toEqual([]); expect(good.files).toBe(6); expect(good.bytes).toBe(198);
    let n = 0;
    const incomplete = checkSceneFiles(scene([cube()]), () => n++ === 1 ? null : png(64, 64));
    expect(incomplete.problems).toEqual([{ path: "$.assets[image].representations[preview].faces.nx", message: "https://scene.test/tour/shared.png does not exist" }]);
    expect(incomplete.bytes).toBe(165);
  });

  it("retains whole-image header and group-byte diagnostics", () => {
    const record = { id: "whole", role: "immersion", projection: "equirectangular", mimeType: "image/png", width: 128, height: 64,
      encodedBytes: 34, url: "https://scene.test/tour/whole.png" };
    const report = checkSceneFiles(scene([record]), () => png(64, 64));
    expect(report.problems.map(problem => problem.path)).toEqual([
      "$.assets[image].representations[whole].url", "$.assets[image].representations[whole].encodedBytes",
    ]);
    expect(report.problems[0].message).toMatch(/is 64×64 pixels, declared 128×64/);
  });

  it("uses tiled owner file addresses and preserves per-level totals", () => {
    const record = { id: "tiles", role: "immersion", projection: "tiled-cube", mimeType: "image/png", warp: "gnomonic",
      faceSize: 128, tileSize: 64, gutter: 2, levelBytes: [198, 792], encodedBytes: 990, url: "https://scene.test/tour/tiles/" };
    const files = [...tiledCubeFilesWithLevel(record)], missing = files[7];
    const incomplete = checkSceneFiles(scene([record]), url => url === missing.url ? null : png(68, 68));
    expect(incomplete.problems).toEqual([{ path: `$.assets[image].representations[tiles]${missing.fieldPath}`, message: `${missing.url} does not exist` }]);
    const bytes = png(68, 68), larger = new Uint8Array([...bytes, 0]);
    const complete = checkSceneFiles(scene([record]), url => url === missing.url ? larger : bytes);
    expect(complete.problems.map(problem => problem.path)).toEqual([
      "$.assets[image].representations[tiles].encodedBytes", "$.assets[image].representations[tiles].levelBytes[1]",
    ]);
  });

  it("keeps sheet file, header and encoded-size diagnostics in the extension owner home", () => {
    const name = "foss-earth.preview-sheets", sheet = { id: "sheet", url: "https://scene.test/tour/sheet.png", mimeType: "image/png", width: 384, height: 64, encodedBytes: 33 };
    const document = scene([], new Map([[name, new Map([[sheet.id, sheet]])]]));
    const missing = checkSceneFiles(document, () => null);
    expect(missing.problems[0].path).toBe(`$.extensions.${name}.sheets[sheet].url`);
    const bad = checkSceneFiles(document, () => new Uint8Array([...png(64, 64), 0]));
    expect(bad.problems.map(problem => problem.path)).toEqual([`$.extensions.${name}.sheets[sheet].url`, `$.extensions.${name}.sheets[sheet].encodedBytes`]);
  });
});

describe("local publication reader and CLI", () => {
  it("reads only files within the declared folder, including decoded paths and symlinks", () => {
    const root = scratch(), served = path.join(root, "served"); mkdirSync(served);
    writeFileSync(path.join(served, "own.png"), png(1, 1));
    writeFileSync(path.join(root, "outside.png"), png(2, 2));
    symlinkSync(path.join(root, "outside.png"), path.join(served, "link.png"));
    const reader = localSceneReader(served, "https://scene.test/tour/scene.json");
    expect(reader.read("https://scene.test/tour/own.png")).toEqual(png(1, 1));
    for (const url of ["https://other.test/tour/own.png", "https://scene.test/tour/%2e%2e%2foutside.png", "https://scene.test/tour/link.png"]) {
      expect(reader.read(url)).toBeNull(); expect(reader.outside.has(url)).toBe(true);
    }
    expect(reader.read("https://scene.test/tour/missing.png")).toBeNull();
    expect(reader.outside.has("https://scene.test/tour/missing.png")).toBe(false);
  });

  it("preserves the original CLI report and JSON using compiled public owners", () => {
    const root = scratch(), manifest = path.join(root, "scene.json"), report = path.join(root, "report.json");
    writeFileSync(manifest, JSON.stringify({ format: "foss-earth-scene", version: 1, id: "empty", revision: "r1", title: "Empty fixture", assets: [], entities: [] }));
    expect(checkSceneManifest(manifest).ok).toBe(true);
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../node/check-cli.mjs", import.meta.url)), manifest, "--json", report], { encoding: "utf8" });
    expect(child.status).toBe(0); expect(child.stderr).toBe("");
    expect(child.stdout).toMatch(/^OK: Empty fixture \(empty, revision r1\)\n {2}0 panoramas, 0 images, 0 groups, 0 links; manifest \d+ bytes\n {2}0 media files, 0.0 MiB\n$/);
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({ ok: true, summary: { id: "empty", assets: 0, files: 0 } });
    writeFileSync(manifest, "{}");
    const invalid = spawnSync(process.execPath, [fileURLToPath(new URL("../node/check-cli.mjs", import.meta.url)), manifest], { encoding: "utf8" });
    expect(invalid.status).toBe(1); expect(invalid.stdout).toBe("FAILED: the manifest is not a valid scene\n");
    expect(invalid.stderr).toMatch(/^error /);
  });
});
