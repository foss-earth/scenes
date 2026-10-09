import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { encodePng } from "@foss-earth/images/node";
import { CUBE_FACE_NAMES } from "@foss-earth/cubemap/core";
import { addPreviewSheets, PREVIEW_SHEETS_EXTENSION, sheetsOf, verifyPreviewSheets } from "@foss-earth/preview-sheets/preparation";
import { buildScenePreviewSheets } from "../node/preview-sheets.mjs";
import { checkSceneManifest } from "../node/scene-check.mjs";
import { createPreviewFixture } from "./preview-files.fixture.mjs";

function fixture() {
  const build = fileURLToPath(new URL("../build/preview-document/", import.meta.url)); mkdirSync(build, { recursive: true });
  const root = mkdtempSync(path.join(build, "fixture-")), folder = path.join(root, "scene"); mkdirSync(folder);
  return { root, folder, ...createPreviewFixture(folder, { encodePng, faces: CUBE_FACE_NAMES }) };
}

describe("scene-owned preview document composition through public preparation", () => {
  it("matches the public packer, preserves revisions and every original fallback file, and checks generated media", () => {
    const f = fixture(), before = structuredClone(f.document), expected = addPreviewSheets(before, { read: f.read, quality: 80 });
    const result = buildScenePreviewSheets(f.manifest);
    expect(result.document).toEqual(expected.document); expect(result.cubes).toBe(1); expect(result.files[0].bytes).toEqual(expected.files[0].bytes);
    expect(result.document.revision).toBe("host-revision"); expect(result.document.assets[0].revision).toBe("image-r1");
    for (const [url, bytes] of f.originals) expect(f.read(url)).toEqual(bytes);
    expect(verifyPreviewSheets(result.document, f.read).problems).toEqual([]); expect(checkSceneManifest(f.manifest).ok).toBe(true);
    expect(JSON.parse(readFileSync(f.manifest, "utf8"))).toEqual(result.document);
  });
  it("migrates legacy places and removes only obsolete local sheet files while preserving foreign and original inputs", () => {
    const f = fixture(), external = path.join(f.root, "external.jpg"); writeFileSync(external, "external");
    const obsolete = path.join(f.folder, "old.jpg"); writeFileSync(obsolete, "obsolete");
    f.document.sheets = [{ id: "old", url: "old.jpg" }, { id: "external", url: "../external.jpg" }, { id: "original", url: "originals/px.png" }];
    f.document.assets[0].representations[0].sheet = { id: "old", x: 0, y: 0 }; f.save();
    const result = buildScenePreviewSheets(f.manifest);
    expect(result.document.sheets).toBeUndefined(); expect(result.document.assets[0].representations[0].sheet).toBeUndefined(); expect(sheetsOf(result.document)).toHaveLength(1);
    expect(existsSync(obsolete)).toBe(false); expect(readFileSync(external, "utf8")).toBe("external");
    for (const [url, bytes] of f.originals) expect(f.read(url)).toEqual(bytes);
  });
  it("leaves six-face fallback valid when a requested preview size has no cubes", () => {
    const f = fixture(); buildScenePreviewSheets(f.manifest); const previous = JSON.parse(readFileSync(f.manifest, "utf8"));
    const result = buildScenePreviewSheets(f.manifest, { faceSize: 16 }); expect(result.cubes).toBe(0); expect(result.files).toEqual([]); expect(sheetsOf(result.document)).toEqual([]);
    expect(existsSync(path.join(f.folder, previous.extensions[PREVIEW_SHEETS_EXTENSION].sheets[0].url))).toBe(false);
    expect(checkSceneManifest(f.manifest).ok).toBe(true); for (const [url, bytes] of f.originals) expect(f.read(url)).toEqual(bytes);
  });
  it("protects a declared original cube that the smallest-preview packer does not select", () => {
    const f = fixture(), larger = { ...structuredClone(f.document.assets[0].representations[0]), id: "larger", faceSize: 16, faces: {} }; mkdirSync(path.join(f.folder, "larger"));
    let encodedBytes = 0;
    for (const face of CUBE_FACE_NAMES) { const url = `larger/${face}.png`, bytes = encodePng({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(90) }); writeFileSync(path.join(f.folder, url), bytes); larger.faces[face] = url; encodedBytes += bytes.length; }
    larger.encodedBytes = encodedBytes; f.document.assets[0].representations.push(larger); f.document.sheets = [{ id: "wrong-old-record", url: "larger/px.png" }]; f.save(); const original = readFileSync(path.join(f.folder, "larger/px.png"));
    expect(buildScenePreviewSheets(f.manifest).cubes).toBe(1); expect(readFileSync(path.join(f.folder, "larger/px.png"))).toEqual(original); expect(checkSceneManifest(f.manifest).ok).toBe(true);
  });
  it("refuses escaping face URLs and symlinks before changing the manifest or old sheets", () => {
    for (const mode of ["encoded", "symlink", "protocol"]) {
      const f = fixture(), outside = path.join(f.root, "outside.png"); writeFileSync(outside, f.originals.get("originals/px.png"));
      const old = path.join(f.folder, "old.jpg"); writeFileSync(old, "old"); f.document.sheets = [{ id: "old", url: "old.jpg" }];
      const url = mode === "encoded" ? "%2e%2e%2foutside.png" : mode === "protocol" ? "https://example.invalid/outside.png" : "link.png";
      if (mode === "symlink") symlinkSync(outside, path.join(f.folder, url)); f.document.assets[0].representations[0].faces.px = url; f.save(); const before = readFileSync(f.manifest);
      expect(() => buildScenePreviewSheets(f.manifest)).toThrow("outside the scene's folder"); expect(readFileSync(f.manifest)).toEqual(before); expect(readFileSync(old, "utf8")).toBe("old"); expect(readFileSync(outside)).toEqual(f.originals.get("originals/px.png"));
    }
  });
  it("refuses a generated path with an escaping existing parent, including when its final file is absent", () => {
    const f = fixture(), outside = path.join(f.root, "outside"); mkdirSync(outside); symlinkSync(outside, path.join(f.folder, "media")); const before = readFileSync(f.manifest);
    expect(() => buildScenePreviewSheets(f.manifest)).toThrow("outside the scene's folder"); expect(readFileSync(f.manifest)).toEqual(before); expect(existsSync(path.join(outside, "previews-8.jpg"))).toBe(false);
  });
  it("refuses a manifest symlink escaping its own folder before reading or writing media", () => {
    const f = fixture(), alias = path.join(f.root, "alias"); mkdirSync(alias); const link = path.join(alias, "scene.json"); symlinkSync(f.manifest, link); const before = readFileSync(f.manifest);
    expect(() => buildScenePreviewSheets(link)).toThrow("outside the scene's folder"); expect(readFileSync(f.manifest)).toEqual(before); expect(existsSync(path.join(f.folder, "media"))).toBe(false);
  });
  it("refuses generated sheets that would overwrite an original input through its path or symlink alias", () => {
    for (const mode of ["same", "alias"]) {
      const f = fixture(); mkdirSync(path.join(f.folder, "media")); const target = path.join(f.folder, "media/previews-8.jpg"), bytes = f.originals.get("originals/px.png");
      if (mode === "alias") symlinkSync(path.join(f.folder, "originals/px.png"), target);
      else { writeFileSync(target, bytes); f.document.assets[0].representations[0].faces.px = "media/previews-8.jpg"; f.save(); }
      const before = readFileSync(f.manifest); expect(() => buildScenePreviewSheets(f.manifest)).toThrow("original face file"); expect(readFileSync(f.manifest)).toEqual(before); expect(readFileSync(target)).toEqual(bytes);
    }
  });
  it("retains original CLI inline/separate arguments, reports, revision behavior, help and failure statuses", () => {
    const f = fixture(), cli = fileURLToPath(new URL("../node/build-preview-cli.mjs", import.meta.url));
    const child = spawnSync(process.execPath, [cli, f.manifest, "--quality=95", "--face-size", "8", "--max-pixels=384"], { encoding: "utf8" });
    expect(child.status).toBe(0); expect(child.stderr).toBe(""); expect(child.stdout).toMatch(/^1 preview cubes in 1 sheet: media\/previews-8.jpg \(\d+ KiB\)\n$/); expect(JSON.parse(readFileSync(f.manifest, "utf8")).revision).toBe("host-revision");
    const empty = spawnSync(process.execPath, [cli, f.manifest, "--face-size=16"], { encoding: "utf8" }); expect(empty.status).toBe(0); expect(empty.stdout).toBe("No preview cubes of that size: the scene is unchanged but for its sheets, which are gone.\n");
    const help = spawnSync(process.execPath, [cli, f.manifest, "--help"], { encoding: "utf8" }); expect(help.status).toBe(0); expect(help.stdout).toContain("--face-size");
    expect(spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).status).toBe(1);
    expect(spawnSync(process.execPath, [cli, f.manifest, "--max-pixels=1"], { encoding: "utf8" }).status).toBe(1);
  });
});
