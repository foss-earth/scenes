import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [consumerArg, artifactArg] = process.argv.slice(2);
if (!consumerArg || !artifactArg) throw new Error("Usage: check-installed-artifact.mjs <isolated installed consumer> <actual scenes tgz>");
const consumer = path.resolve(consumerArg), artifact = path.resolve(artifactArg), original = JSON.parse(readFileSync(path.join(consumer, "proposal-example.scene.json"), "utf8"));
const resolverPath = path.join(consumer, "resolve-exports.mjs"); writeFileSync(resolverPath, "export const resolvePublic = name => import.meta.resolve(name);\n");
const { resolvePublic } = await import(pathToFileURL(resolverPath));
const workspace = realpathSync(consumer) + path.sep;
let allowUiRuntime = false;
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (result.url.startsWith("file:")) {
    const actual = realpathSync(fileURLToPath(result.url));
    if (!actual.startsWith(workspace)) throw new Error("OUTSIDE_ISOLATED_WORKSPACE: " + actual);
    if (/[/\\]node_modules[/\\](?:@babylonjs[/\\]core|@foss-earth[/\\]renderer|react(?:-dom)?)(?:[/\\]|$)/.test(actual)) throw new Error("Unrelated runtime peer initialized: " + actual);
    if (!allowUiRuntime && /[/\\]node_modules[/\\]@foss-earth[/\\]ui(?:[/\\]|$)/.test(actual)) throw new Error("Scene browser import initialized optional UI runtime: " + actual);
  }
  return result;
} });
let dom;
try {
const outside = path.join(path.dirname(consumer), "outside-negative-control.mjs"); writeFileSync(outside, "export const mustNeverLoad = true;\n");
await assert.rejects(import(pathToFileURL(outside)), /OUTSIDE_ISOLATED_WORKSPACE/);
const { JSDOM } = await import(resolvePublic("jsdom")); dom = new JSDOM("<!doctype html><main></main>");
for (const name of ["document", "window", "navigator", "fetch", "requestAnimationFrame"]) Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error(`Pure import read ${name}`); } });
const core = await import(resolvePublic("@foss-earth/scenes")), browser = await import(resolvePublic("@foss-earth/scenes/browser")), panel = await import(resolvePublic("@foss-earth/scenes/panel"));
const viewerCore = await import(resolvePublic("@foss-earth/360")), preview = await import(resolvePublic("@foss-earth/preview-sheets/scene-extension"));
const checker = await import(resolvePublic("@foss-earth/scenes/node")), previewDocument = await import(resolvePublic("@foss-earth/scenes/preview-sheets"));
for (const name of ["document", "window", "navigator", "fetch", "requestAnimationFrame"]) delete globalThis[name];
allowUiRuntime = true;
const plugins = viewerCore.createBuiltInRepresentations(() => ({ tileMemoryBytes: 1024 * 1024, responseBytes: 1024 * 1024, requests: 2, waiting: 2, uploadOutstandingBytes: 1024 * 1024 }));
const validation = { representations: plugins.map(plugin => plugin.hooks), validateImageAsset: viewerCore.validateViewerAsset, extensionHooks: [preview.createPreviewSheetsExtensionHook()], baseUrl: "https://host.example/tour/scene.json" };
const result = core.validateScene(original, validation); assert.equal(result.ok, true); assert.deepEqual(result.scene.entityOrder, ["garden", "courtyard"]); assert.equal(result.scene.assets.get("garden-image").representations[0].faces.px, "https://host.example/tour/media/garden/128/px.jpg");
const unsupported = structuredClone(original); unsupported.entities.splice(1, 0, { id: "future", type: "future" }); unsupported.assets[0].representations.push({ projection: "future" }); const preserved = core.validateScene(unsupported, validation); assert.equal(preserved.ok, true); assert.deepEqual(preserved.scene.entityOrder, ["garden", "future", "courtyard"]); assert.equal(preserved.scene.warnings.length, 2);
const actions = [], disposals = [], inputs = [], subscribers = new Set(); let state = { phase: "overview", active: null, target: null };
const viewer = {
  async prepare(input, signal) { assert.equal(signal.aborted, false); inputs.push(input); return { id: input.id, async ready() {}, updatePlacement() {}, hover() {}, dispose() { disposals.push(input.id); } }; },
  replaceImages(images) { actions.push(["publish", images.map(image => image.id)]); state = { phase: "overview", active: null, target: null }; },
  async enter(id) { state = { phase: "immersive", active: id, target: null }; for (const callback of subscribers) callback(state); return true; },
  exit() { state = { phase: "overview", active: null, target: null }; }, status: () => state, subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }, pick: () => ["garden"], hover() {},
};
const world = { resolvePlacement(entity, { radiusMeters }) { return { placement: { marker: null, radiusMeters, content: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ...entity.markerStyle }, state: "pending" }; }, async showOverview() { return { ok: true, state: "applied" }; } };
const loaded = await browser.loadScene(original, { ...validation, viewer, world, markerRadiusMeters: () => 1, sessionId: "explicit-host-session", history: browser.createMemorySceneHistory() }); assert.equal(loaded.ok, true); await loaded.handle.whenSettled();
assert.equal(inputs[0].placement.marker, null); assert.equal(inputs[0].details.capture.heightMeters, null); assert.equal("entities" in inputs[0], false); assert.equal(await inputs[0].actions[0].activate(), true); assert.equal(loaded.handle.status.active, "courtyard");
// Scene status passes the supplied viewer's published observations through unchanged.
// Missing or cleared readings cannot be replaced by an authored/requested detail value.
assert.equal("immersionDetail" in loaded.handle.status, false);
const detailSnapshots = [], offDetail = loaded.handle.subscribe(status => detailSnapshots.push(status));
const publishViewerStatus = next => { state = next; for (const callback of subscribers) callback(state); };
try {
  const first = { representation: "preview-published", loading: "tiles-in-flight", limitation: "memory", progress: Object.freeze(["resident parent retained"]) };
  publishViewerStatus({ phase: "immersive", active: "courtyard", target: null, immersionDetail: first });
  assert.equal(loaded.handle.status.immersionDetail, first); assert.equal(detailSnapshots.at(-1).immersionDetail, first);
  const finer = { representation: "tiles-published", loading: null, limitation: null, progress: Object.freeze(["replacement published"]) };
  publishViewerStatus({ phase: "immersive", active: "courtyard", target: null, immersionDetail: finer });
  assert.equal(loaded.handle.status.immersionDetail, finer); assert.equal(detailSnapshots.at(-1).immersionDetail, finer); assert.equal(first.representation, "preview-published");
  publishViewerStatus({ phase: "immersive", active: "courtyard", target: null, immersionDetail: null });
  assert.equal(loaded.handle.status.immersionDetail, null); assert.equal(detailSnapshots.at(-1).immersionDetail, null);
  publishViewerStatus({ phase: "immersive", active: "courtyard", target: null });
  assert.equal("immersionDetail" in loaded.handle.status, false); assert.equal("immersionDetail" in detailSnapshots.at(-1), false);
} finally { offDetail(); }
assert.equal((await loaded.handle.replace({ ...original, version: 2 })).ok, false); assert.equal(loaded.handle.status.active, "courtyard"); assert.deepEqual(disposals, []);
const page = dom.window.document, controller = browser.createSceneController({ examples: [], baseUrl: validation.baseUrl, load: async () => ({ ok: true, handle: loaded.handle }) }); assert.equal(await controller.load("scene.json"), true);
const ui = { parameterSection({ main }) { return { element: main, destroy() {} }; }, sections(sections) { const element = page.createElement("div"); for (const section of sections) element.append(section.element); return { element, destroy() { element.remove(); } }; } };
const mounted = panel.createScenesPanel({ document: page, controller, ui }); page.querySelector("main").append(mounted.element); assert.match(mounted.element.textContent, /Garden and courtyard/); mounted.destroy(); controller.destroy(); await controller.whenSettled(); assert.deepEqual(disposals.sort(), ["courtyard", "garden"]); assert.equal(subscribers.size, 0);
// Saved-images presentation consumes the actual common store, never a scene singleton.
const { createMediaStore } = await import(resolvePublic("@foss-earth/images"));
let groups = [{ id: "old", label: "Older", files: 1, bytes: 1024, used: 10 }, { id: "new", label: "Most recent", files: 1, bytes: 2048, used: 20 }];
const media = createMediaStore({ maxBytes: 1024 * 1024, now: () => 30, open: async () => ({ groups: async () => groups, clear: async () => { groups = []; }, read: async () => { throw new Error("Unexpected file read"); }, write: async () => { throw new Error("Unexpected file write"); }, touch: async () => {}, drop: async () => {}, remove: async () => {} }) });
let refreshSaved = () => {}, savedDetaches = 0;
const saved = browser.createSavedImagesSection({ document: page, source: media, maxListedGroups: () => 1, refresh: { subscribe(work) { refreshSaved = work; return () => { savedDetaches += 1; }; } } });
page.querySelector("main").append(saved.element);
const settleSaved = async () => { for (let turn = 0; turn < 16; turn++) await Promise.resolve(); };
await settleSaved(); assert.deepEqual([...saved.element.querySelectorAll("li span")].map(node => node.textContent), ["Most recent"]); assert.match(saved.element.textContent, /And 1 more/);
saved.element.querySelector("button").click(); await settleSaved(); assert.match(saved.element.textContent, /0 files of 0 images/); assert.match(saved.element.querySelector("[role=status]").textContent, /^Saved images cleared\./);
saved.destroy(); saved.destroy(); refreshSaved(); await settleSaved(); assert.equal(savedDetaches, 1); assert.equal(saved.element.isConnected, false);
// Scene-specific formatting binds the supplied public UI log; TTL authority stays UI-owned.
const { createGameLog } = await import(resolvePublic("@foss-earth/ui/browser")), { createSettingsRegistry, UI_PARAMETERS } = await import(resolvePublic("@foss-earth/ui/settings"));
const uiStyles = new URL(resolvePublic("@foss-earth/ui/styles.css")), cacheStyles = new URL("./cacheSection.css", uiStyles);
for (const url of [uiStyles, cacheStyles]) assert.ok(realpathSync(fileURLToPath(url)).startsWith(workspace), "UI stylesheet escaped isolated workspace");
assert.match(readFileSync(uiStyles, "utf8"), /@import\s+["']\.\/cacheSection\.css["']/); assert.match(readFileSync(cacheStyles, "utf8"), /\.foss-earth-map-cache-section/); assert.match(readFileSync(cacheStyles, "utf8"), /\.foss-earth-map-cache__tile/);
const logSettings = createSettingsRegistry({ storage: null }); logSettings.register(UI_PARAMETERS);
const gameLog = createGameLog(logSettings, { element: page.createElement("div"), copy: async () => {}, onSize() {}, viewportHeight: () => 800, isCentered: () => false, timers: { set: (work, ms) => dom.window.setTimeout(work, ms), clear: timer => { if (typeof timer === "number") dom.window.clearTimeout(timer); } } });
const logController = browser.createSceneController({ examples: [], baseUrl: validation.baseUrl, load: async (url, ports) => { ports.onProgress({ id: url, title: url, kind: "manifest", state: "loading", receivedBytes: 512, totalBytes: 1024 }); return { ok: false, errors: [{ path: "$", message: `${url} could not be fetched: Synthetic refusal` }] }; } });
const offLog = browser.connectSceneLog(logController, gameLog); assert.equal(await logController.load("missing.scene.json"), false); assert.match(gameLog.element.textContent, /could not be fetched: Synthetic refusal/);
offLog(); offLog(); logController.destroy(); gameLog.destroy();
const packageDirectory = path.dirname(path.dirname(fileURLToPath(resolvePublic("@foss-earth/scenes")))), manifest = JSON.parse(readFileSync(path.join(packageDirectory, "package.json"), "utf8"));
for (const name of [".", "./browser", "./panel", "./node", "./preview-sheets"]) assert.ok(readFileSync(path.join(packageDirectory, manifest.exports[name].types), "utf8").length);
const schema = JSON.parse(readFileSync(new URL(resolvePublic("@foss-earth/scenes/schema.json")), "utf8")); assert.equal(schema.$defs.panoramaAsset.properties.representations.contains, undefined); assert.match(readFileSync(new URL(resolvePublic("@foss-earth/scenes/panel.css")), "utf8"), /flex-wrap/);
const { encodePng } = await import(resolvePublic("@foss-earth/images/node")), { CUBE_FACE_NAMES } = await import(resolvePublic("@foss-earth/cubemap/core"));
const { createPreviewFixture } = await import(pathToFileURL(path.join(consumer, "preview-files.fixture.mjs")));
const mediaFolder = path.join(consumer, "scene-files"); mkdirSync(mediaFolder); const fixture = createPreviewFixture(mediaFolder, { encodePng, faces: CUBE_FACE_NAMES });
const built = previewDocument.buildScenePreviewSheets(fixture.manifest); assert.equal(built.cubes, 1); assert.equal(built.document.revision, "host-revision");
for (const [url, bytes] of fixture.originals) assert.deepEqual(fixture.read(url), bytes);
const checked = checker.checkSceneManifest(fixture.manifest); assert.equal(checked.ok, true); assert.equal(checked.summary.files, 7); assert.equal(checked.summary.sheets, 1);
const validated = core.validateScene(JSON.parse(readFileSync(fixture.manifest, "utf8")), validation); assert.equal(validated.ok, true);
const local = checker.localSceneReader(mediaFolder, "https://host.example/tour/scene.json");
assert.deepEqual(checker.checkSceneFiles(validated.scene, local.read).problems, []);
assert.deepEqual(core.checkSceneFiles(validated.scene, local.read, { representations: checker.builtInSceneHooks() }).problems, []);
const guard = path.join(consumer, "source-check-guard.mjs");
const childEnvironment = { ...process.env }; delete childEnvironment.NODE_PATH; delete childEnvironment.NODE_OPTIONS;
const child = (entry, args) => spawnSync(process.execPath, ["--import", guard, fileURLToPath(resolvePublic(entry)), ...args], { cwd: consumer, env: childEnvironment, encoding: "utf8" });
const reportFile = path.join(consumer, "scene-report.json"), checkedCli = child("@foss-earth/scenes/check-cli", [fixture.manifest, "--base-url=https://host.example/tour/scene.json", "--json", reportFile]);
assert.equal(checkedCli.status, 0, checkedCli.stderr); assert.match(checkedCli.stdout, /^OK: Synthetic preview fixture/); assert.equal(JSON.parse(readFileSync(reportFile, "utf8")).summary.files, 7);
const fallback = child("@foss-earth/scenes/build-preview-cli", [fixture.manifest, "--face-size=16"]); assert.equal(fallback.status, 0, fallback.stderr); assert.match(fallback.stdout, /^No preview cubes of that size:/); assert.equal(checker.checkSceneManifest(fixture.manifest).ok, true);
for (const [url, bytes] of fixture.originals) assert.deepEqual(fixture.read(url), bytes);
const alias = path.join(consumer, "manifest-alias"); mkdirSync(alias); const linked = path.join(alias, "scene.json"); symlinkSync(fixture.manifest, linked); const before = readFileSync(fixture.manifest);
assert.throws(() => previewDocument.buildScenePreviewSheets(linked), /outside the scene's folder/); assert.deepEqual(readFileSync(fixture.manifest), before);
const negative = spawnSync(process.execPath, ["--import", guard, outside], { cwd: consumer, env: childEnvironment, encoding: "utf8" }); assert.notEqual(negative.status, 0); assert.match(negative.stderr, /OUTSIDE_ISOLATED_WORKSPACE/);
assert.equal(manifest.bin["foss-earth-check-scene"], manifest.exports["./check-cli"]); assert.equal(manifest.bin["foss-earth-build-preview-sheets"], manifest.exports["./build-preview-cli"]);
const receipt = { package: manifest.name, version: manifest.version, artifact: path.basename(artifact), sha256: createHash("sha256").update(readFileSync(artifact)).digest("hex"), node: process.version, sourceRevision: manifest.fossEarthSplit.sourceRevision, installedEntries: [".", "./browser", "./panel", "./schema.json", "./panel.css", "./node", "./preview-sheets", "./check-cli", "./build-preview-cli"], pureImport: true, isolatedRealpathResolution: true, guardedCliNegativeControl: true, actual360Catalogue: true, optionalPreviewOwnerHook: true, preservedOrderAndUnsupportedProjection: true, injectedViewerWorldNavigation: true, viewerOwnedDetailObservations: true, prepublicationPreservation: true, ownerDisposal: true, explicitPanelDocumentUi: true, actualPublicMediaStoreSavedPresentation: true, actualPublicUiSceneLog: true, optionalUiInitializationGuard: true, publicPreviewDocumentFallback: true, manifestSymlinkRefusal: true, declarations: true, publication: "unaccepted local staging; no destination/remote admission asserted" };
writeFileSync(path.join(consumer, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n"); process.stdout.write(JSON.stringify(receipt) + "\n");
} finally { dom?.window.close(); hook.deregister(); }
