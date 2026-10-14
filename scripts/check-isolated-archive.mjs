import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const owner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const at = arg.indexOf("="); assert.ok(arg.startsWith("--") && at > 2, "Use --name=value"); return [arg.slice(2, at), arg.slice(at + 1)]; }));
assert.ok(args.archives && /^[a-f0-9]{64}$/.test(args["archives-sha256"] ?? ""), "Supply --archives=<complete exact archive closure JSON> and --archives-sha256=<64hex>");
const closurePath = path.resolve(args.archives), closureBytes = readFileSync(closurePath);
assert.equal(createHash("sha256").update(closureBytes).digest("hex"), args["archives-sha256"]);
const closure = JSON.parse(closureBytes); assert.equal(closure.schemaVersion, 1); assert.ok(Array.isArray(closure.packages) && closure.packages.length > 0);
const required = ["@foss-earth/scenes", "@foss-earth/images", "@foss-earth/image-viewer", "@foss-earth/sphere-tiled-cubemap", "@foss-earth/preview-sheets", "@foss-earth/sphere-cubemap", "@foss-earth/sphere-equirectangular", "@foss-earth/ui", "jpeg-js", "jsdom", "typescript", "@types/node", "undici-types"];
const pins = {}, dependencies = {};
for (const entry of closure.packages) {
  assert.ok(entry.name && entry.version && entry.archive && /^[a-f0-9]{64}$/.test(entry.sha256 ?? ""), "Every closure package needs name, version, archive and exact sha256");
  assert.equal(pins[entry.name], undefined, "One exact version per package name; supply a compatible complete closure");
  const archive = path.resolve(path.dirname(closurePath), entry.archive), bytes = readFileSync(archive);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `Archive digest mismatch: ${entry.name}`);
  const unpack = spawnSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" });
  if (unpack.error) throw unpack.error; assert.equal(unpack.status, 0, `Cannot inspect ${archive}`);
  const metadata = JSON.parse(unpack.stdout); assert.equal(metadata.name, entry.name); assert.equal(metadata.version, entry.version);
  dependencies[entry.name] = `file:${archive}`; pins[entry.name] = { archive, sha256: entry.sha256, version: entry.version, sizeBytes: bytes.length };
}
for (const name of required) assert.ok(pins[name], `Missing mandatory archive: ${name}`);
assert.equal(pins.typescript.version, "5.9.3"); assert.equal(pins.jsdom.version, "29.1.1"); assert.equal(pins["jpeg-js"].version, "0.4.4");
for (const name of required.filter(name => name.startsWith("@foss-earth/"))) assert.equal(pins[name].version, "0.1.0");
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const output = path.resolve(args.out ?? path.join(owner, "build", "installed-consumer", stamp));
assert.ok(output.startsWith(path.join(owner, "build") + path.sep), "Evidence stays inside this owner's build/");
mkdirSync(output, { recursive: true });
assert.ok(realpathSync(output).startsWith(realpathSync(path.join(owner, "build")) + path.sep), "Evidence parent escaped owner build/ through a symlink");
const workspace = path.join(output, "workspace"); mkdirSync(workspace); // never overwrite a prior consumer
const temp = path.join(output, "temp"); mkdirSync(temp);
const environment = { ...process.env, npm_config_cache: path.join(output, "npm-cache"), TMPDIR: temp, TMP: temp, TEMP: temp };
delete environment.NODE_PATH; delete environment.NODE_OPTIONS;
writeFileSync(path.join(output, "archive-closure.json"), closureBytes);
writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "scenes-isolated-consumer", version: "1.0.0", private: true, type: "module", dependencies }, null, 2));
const run = (command, argv, log) => {
  const file = path.join(output, log), fd = openSync(file, "wx"); let result;
  try { result = spawnSync(command, argv, { cwd: workspace, env: environment, stdio: ["ignore", fd, fd] }); }
  finally { closeSync(fd); }
  if (result.error) throw result.error; assert.equal(result.status, 0, `Inspect ${file}`);
  return readFileSync(file, "utf8");
};
run("npm", ["install", "--offline", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund", "--cache", path.join(output, "npm-cache")], "install.log");
const installed = [];
function inspectModules(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.name.startsWith("@")) { inspectModules(candidate); continue; }
    const actual = realpathSync(candidate); assert.ok(actual.startsWith(realpathSync(workspace) + path.sep), "Installed package symlink escaped workspace");
    const metadata = JSON.parse(readFileSync(path.join(actual, "package.json"), "utf8"));
    assert.ok(pins[metadata.name], `Undeclared transitive package: ${metadata.name}`); assert.equal(metadata.version, pins[metadata.name].version, `Undeclared transitive version: ${metadata.name}`);
    const files = [];
    function inventory(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === "node_modules") continue;
        const file = path.join(directory, entry.name), stat = lstatSync(file), relative = path.relative(actual, file);
        if (entry.isDirectory()) { files.push({ path: relative, type: "directory", mode: stat.mode & 0o777 }); inventory(file); }
        else if (entry.isFile()) { const bytes = readFileSync(file); files.push({ path: relative, type: "file", mode: stat.mode & 0o777, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }); }
        else if (entry.isSymbolicLink()) { assert.ok(realpathSync(file).startsWith(realpathSync(workspace) + path.sep)); files.push({ path: relative, type: "symlink", mode: stat.mode & 0o777, target: readlinkSync(file) }); }
        else assert.fail("Unexpected installed file type: " + file);
      }
    }
    inventory(actual);
    const fileMap = path.join(output, `installed-map-${installed.length}.json`); writeFileSync(fileMap, JSON.stringify(files, null, 2) + "\n");
    installed.push({ name: metadata.name, version: metadata.version, path: path.relative(workspace, actual), files: files.length, fileMap, fileMapSha256: createHash("sha256").update(readFileSync(fileMap)).digest("hex") });
    if (readdirSync(actual).includes("node_modules")) inspectModules(path.join(actual, "node_modules"));
  }
}
inspectModules(path.join(workspace, "node_modules"));
const guard = path.join(workspace, "source-check-guard.mjs");
copyFileSync(path.join(owner, "scripts", "runtime-guard.mjs"), guard);
copyFileSync(path.join(owner, "scripts", "check-installed-artifact.mjs"), path.join(workspace, "installed-consumer.mjs"));
copyFileSync(path.join(owner, "tests", "fixtures", "proposal-example.scene.json"), path.join(workspace, "proposal-example.scene.json"));
copyFileSync(path.join(owner, "tests", "preview-files.fixture.mjs"), path.join(workspace, "preview-files.fixture.mjs"));
copyFileSync(path.join(owner, "fixtures", "composition", "release-composition.fixture.mjs"), path.join(workspace, "release-composition.fixture.mjs"));
run(process.execPath, [path.join(workspace, "installed-consumer.mjs"), workspace, pins["@foss-earth/scenes"].archive], "runtime.log");
copyFileSync(path.join(owner, "fixtures", "native-composition", "consumer.mjs"), path.join(workspace, "native-consumer.mjs"));
copyFileSync(path.join(owner, "fixtures", "native-composition", "consumer.ts"), path.join(workspace, "native-consumer.ts"));
run(process.execPath, ["--import", guard, path.join(workspace, "native-consumer.mjs")], "native-runtime.log");
copyFileSync(path.join(owner, "tests", "consumer.ts"), path.join(workspace, "consumer.ts"));
copyFileSync(path.join(owner, "fixtures", "360-consumer.ts"), path.join(workspace, "viewer-consumer.ts"));
writeFileSync(path.join(workspace, "pure.ts"), 'import { validateScene, checkSceneFiles, composeSceneSchema } from "@foss-earth/scenes"; import { composeSceneDocuments, type SceneCompositionOptions, type SceneCompositionRequest } from "@foss-earth/scenes/composition"; declare const request: SceneCompositionRequest; declare const options: SceneCompositionOptions; void composeSceneDocuments(request,options).sha256; void [validateScene,checkSceneFiles,composeSceneSchema];\n');
const typeTrace = trace => {
  let resolved = 0;
  for (const match of trace.matchAll(/successfully resolved to '([^']+)'/g)) { resolved += 1; assert.ok(realpathSync(match[1]).startsWith(realpathSync(workspace) + path.sep), "OUTSIDE_ISOLATED_DECLARATIONS: " + match[1]); }
  assert.ok(resolved > 0, "Compiler resolution trace contained no successful public imports");
};
const compiler = path.join(workspace, "node_modules", "typescript", "bin", "tsc");
for (const name of ["pure", "consumer"]) {
  const config = path.join(workspace, `tsconfig.${name}.json`);
  writeFileSync(config, JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2023", "DOM", "DOM.Iterable"], types: name === "pure" ? [] : ["node"], strict: true, skipLibCheck: false, noEmit: true, incremental: true, tsBuildInfoFile: `node_modules/.tmp/${name}.tsbuildinfo` }, files: name === "pure" ? ["pure.ts"] : ["consumer.ts", "viewer-consumer.ts", "native-consumer.ts"] }));
  typeTrace(run(process.execPath, [compiler, "-p", config, "--traceResolution"], `${name}-types.log`));
}
writeFileSync(path.join(output, "outside.d.ts"), "export interface Outside { value: string }\n");
writeFileSync(path.join(workspace, "negative.ts"), 'import type { Outside } from "../outside.js"; export const value: Outside={value:"negative control"};\n');
const negative = path.join(workspace, "tsconfig.negative.json"); writeFileSync(negative, JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", types: [], noEmit: true }, files: ["negative.ts"] }));
assert.throws(() => typeTrace(run(process.execPath, [compiler, "-p", negative, "--traceResolution"], "negative-types.log")), /OUTSIDE_ISOLATED_DECLARATIONS/);
const receipt = { pins, closureSha256: args["archives-sha256"], installed, runtime: { node: process.version, platform: process.platform, arch: process.arch }, checks: ["mandatory exact archive closure and all installed transitive versions", "fresh offline install with owner cache/temp and sanitized NODE_PATH/NODE_OPTIONS", "realpath runtime and declaration guards plus negative controls", "root/browser/panel/Node/preview/schema/CSS/bin entries", "Saved images actual public store and scene-log actual public UI contracts", "public leaf file checker and actual preview document/CLI path and fallback behavior", "no implicit browser/GPU/renderer initialization"], limitations: ["one compatible version per dependency name required", "Node/CPU/DOM fixture only, no browser/GPU/filesystem-race qualification", "shared conformance, lineage, actual application adoption and remote admission remain separately required"] };
writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n"); process.stdout.write(JSON.stringify({ output, receipt }) + "\n");
