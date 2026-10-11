import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { composeSceneDocuments } from "../src/composition.ts";
import { builtInSceneCompositionOwners, composeScenes } from "../node/composition.mjs";
import { validateViewerAsset } from "@foss-earth/360";
import { createNodePreviewSheetsCompositionOwner } from "@foss-earth/preview-sheets/composition-node";
import { PREVIEW_SHEETS_EXTENSION } from "@foss-earth/preview-sheets";
import { createCompositionFixture, assertCompositionResult, sha256 } from "../fixtures/composition/release-composition.fixture.mjs";

const prepare = (fixture, override = {}) => composeSceneDocuments(fixture.request, {
  inputs: fixture.inputs, sha256, representations: builtInSceneCompositionOwners(), validateImageAsset: validateViewerAsset, extensions: fixture.extensions, ...override,
});
const failure = (fixture, code, override) => assert.throws(() => prepare(fixture, override), error => error.code === code);

describe("checked public scene composition", () => {
  it("combines two independently pinned children and one unchanged shared sheet", () => {
    const fixture = createCompositionFixture(), originals = [...fixture.inputs].map(([url, bytes]) => ({ url, reference: bytes, snapshot: Uint8Array.from(bytes) }));
    assertCompositionResult(prepare(fixture), fixture);
    assert.deepEqual([...fixture.inputs.keys()], originals.map(input => input.url));
    for (const input of originals) { assert.equal(fixture.inputs.get(input.url), input.reference); assert.deepEqual(Uint8Array.from(input.reference), input.snapshot); }
  });
  it("is byte deterministic and reads/hashes a shared immutable media file once", () => {
    const fixture = createCompositionFixture(), reads = new Map(), inputs = { get(url) { reads.set(url, (reads.get(url) ?? 0) + 1); return fixture.inputs.get(url); } };
    const first = prepare(fixture, { inputs }); assert.equal(reads.get(fixture.sheetUrl), 1);
    const second = prepare(fixture, { inputs: new Map([...fixture.inputs].reverse()) }); assert.equal(second.manifest, first.manifest); assert.equal(second.sha256, first.sha256);
  });
  it("rejects collisions, then applies explicit reversible aliases to envelope references", () => {
    const fixture = createCompositionFixture(), east = fixture.documents.get("east");
    east.assets[0].id = "a-image"; for (const entity of east.entities) entity.assetId = "a-image"; fixture.repin("east"); failure(fixture, "collision");
    fixture.request.children[1].aliases = { assets: { "a-image": "east.a-image" }, entities: { "b-1": "east.b-1" }, groups: { "b-group": "east.b-group" } };
    const result = prepare(fixture);
    assert.equal(result.document.assets[1].id, "east.a-image"); assert.equal(result.document.entities.find(entity => entity.id === "east.b-1").assetId, "east.a-image");
    assert.equal(result.document.entities.find(entity => entity.id === "a-2").links[0].target, "east.b-1");
    assert.deepEqual(result.document.groups[0].members, ["east.b-1", "b-2"]);
    assert.ok(result.provenance.aliases.some(alias => alias.child === "east" && alias.originalId === "b-1" && alias.outputId === "east.b-1"));
  });
  it("rejects aliases for records that do not exist", () => { const f = createCompositionFixture(); f.request.children[0].aliases = { entities: { missing: "alias" } }; failure(f, "reference"); });
  it("rejects changed bytes without repinning", () => { const f = createCompositionFixture(), url = f.request.children[0].manifest.url; f.inputs.set(url, f.inputs.get(url).map((byte, index) => index === 10 ? byte ^ 1 : byte)); failure(f, "drift"); });
  it("rejects manifest identity/revision drift", () => { const f = createCompositionFixture(); f.request.children[0].manifest.revision = "other"; failure(f, "drift"); });
  it("rejects media release identity drift", () => { const f = createCompositionFixture(); f.request.children[0].media.id = "other"; failure(f, "drift"); });
  it("rejects missing pinned face bytes", () => { const f = createCompositionFixture(); f.inputs.delete([...f.media.get("west").keys()][0]); failure(f, "missing-input"); });
  it("rejects referenced media omitted from the independently pinned index", () => { const f = createCompositionFixture(); f.indices.get("west").files.shift(); f.repin("west"); failure(f, "media"); });
  it("never silently skips an unsupported projection", () => { const f = createCompositionFixture(); f.documents.get("west").assets[0].representations.push({ projection: "future" }); f.repin("west"); failure(f, "owner-required"); });
  it("rejects unresolved local child links", () => { const f = createCompositionFixture(); f.documents.get("west").entities[0].links[0].target = "absent"; f.repin("west"); failure(f, "invalid-scene"); });
  it("rejects unresolved explicit cross-child navigation", () => { const f = createCompositionFixture(); f.request.links[0].to.id = "absent"; failure(f, "reference"); });
  it("rejects a cross-child link colliding with an existing source link", () => { const f = createCompositionFixture(); f.request.links[0].from.id = "a-1"; f.request.links[0].link.id = "local"; failure(f, "collision"); });
  it("rejects incomplete authored order", () => { const f = createCompositionFixture(); f.request.entityOrder.pop(); failure(f, "reference"); });
  it("rejects repeated authored order", () => { const f = createCompositionFixture(); f.request.entityOrder[0] = f.request.entityOrder[1]; failure(f, "collision"); });
  it("rejects omitted groups and missing initial panorama", () => { const f = createCompositionFixture(); f.request.groupOrder.pop(); failure(f, "reference"); const g = createCompositionFixture(); g.request.initialPanorama.id = "missing"; failure(g, "reference"); });
  it("does not use a parent or manifest URL instead of the declared media base", () => { const f = createCompositionFixture(); f.request.children[0].media.baseUrl = "https://wrong.example/parent/scene.json"; const index = f.indices.get("west"); index.files[0].url = "faces/px.png"; f.repin("west"); failure(f, "missing-input"); });
  it("rejects a representation composer that leaves relative URLs", () => {
    const f = createCompositionFixture(), representations = builtInSceneCompositionOwners().map(owner => owner.projection === "cube" ? { ...owner, compose: record => record } : owner);
    failure(f, "media", { representations });
  });
  it("requires an explicit preview-sheet composition owner", () => { const f = createCompositionFixture(); failure(f, "owner-required", { extensions: [] }); });
  it("rejects invalid optional sheet cells instead of publishing fallback-only metadata", () => { const f = createCompositionFixture(); f.documents.get("west").assets[0].representations[0].extensions[PREVIEW_SHEETS_EXTENSION].y = 100; f.repin("west"); failure(f, "invalid-scene"); });
  it("does not overwrite non-equivalent sheet IDs", () => { const f = createCompositionFixture(); f.documents.get("east").extensions[PREVIEW_SHEETS_EXTENSION].sheets[0].revision = "different"; f.repin("east"); assert.throws(() => prepare(f), /Sheet identity collision/); });
  it("does not guess URL or ID fields in opaque required extensions", () => { const f = createCompositionFixture(), d = f.documents.get("west"); d.requiredExtensions = ["example.opaque"]; d.extensions["example.opaque"] = { url: "private/data.json", target: "a-2" }; f.repin("west"); failure(f, "owner-required"); });
  it("preserves inert optional entity records and rejects navigation to them", () => {
    const f = createCompositionFixture(); f.documents.get("west").entities.push({ id: "future", type: "future", payload: { authored: true } }); f.repin("west"); f.request.entityOrder.push({ child: "west", id: "future" });
    const result = prepare(f); assert.deepEqual(result.document.entities.at(-1), { id: "future", type: "future", payload: { authored: true } });
    f.request.links[0].to = { child: "west", id: "future" }; failure(f, "reference");
  });
  it("enforces finite byte/count/depth budgets before returning a candidate", () => {
    for (const limits of [{ entities: 1 }, { assets: 1 }, { groups: 1 }, { representations: 1 }, { links: 1 }, { files: 1 }, { fileBytes: 1 }, { totalInputBytes: 1 }, { manifestBytes: 1 }, { mediaIndexBytes: 1 }, { fileReferences: 1 }, { jsonDepth: 2 }]) failure(createCompositionFixture(), "limit", { limits });
  });
  it("checks pre-cancellation without hashing and cancellation between jobs", () => {
    const f = createCompositionFixture(), controller = new AbortController(); controller.abort(); let calls = 0;
    failure(f, "cancelled", { signal: controller.signal, sha256() { calls++; return "0".repeat(64); } }); assert.equal(calls, 0);
    const mid = new AbortController(); failure(f, "cancelled", { signal: mid.signal, sha256(bytes) { mid.abort(); return sha256(bytes); } });
  });
  it("uses the production Preview owner by default in the public Node composition route", () => {
    const f = createCompositionFixture(); assertCompositionResult(composeScenes(f.request, { inputs: f.inputs }), f);
  });
  it("composes explicit reversible sheet aliases without changing original cells or faces", () => {
    const f = createCompositionFixture(); f.documents.get("east").extensions[PREVIEW_SHEETS_EXTENSION].sheets[0].revision = "alias-r2"; f.repin("east");
    const output = prepare(f, { extensions: [createNodePreviewSheetsCompositionOwner({ aliases: { east: { "shared-sheet": "east-sheet" } } })] });
    assert.deepEqual(output.document.extensions[PREVIEW_SHEETS_EXTENSION].sheets.map(sheet => sheet.id), ["shared-sheet", "east-sheet"]);
    assert.deepEqual(output.document.assets[1].representations[0].extensions[PREVIEW_SHEETS_EXTENSION], { id: "east-sheet", x: 0, y: 8 });
    assert.equal(output.provenance.files.filter(file => file.url === f.sheetUrl).length, 1);
  });
  it("rejects a wrong but in-bounds sheet cell with the actual public verifier", () => {
    const f = createCompositionFixture(); f.documents.get("east").assets[0].representations[0].extensions[PREVIEW_SHEETS_EXTENSION].y = 0; f.repin("east"); failure(f, "media");
  });
  it("does not publish a candidate when the leaf's decode/work/pixel budget is exhausted", () => {
    for (const verificationLimits of [{ maxMemoryBytes: 1 }, { maxDecodedPixels: 1 }, { maxWorkPixels: 1 }]) {
      const f = createCompositionFixture(); assert.throws(() => composeScenes(f.request, { inputs: f.inputs, previewSheets: { verificationLimits } }), /budget/);
    }
  });

  const crossing = () => {
    const f = createCompositionFixture(), west = f.documents.get("west"), east = f.documents.get("east");
    west.externalDestinations = [{ id: "east-route", sceneId: east.id, routeId: "east-tour" }];
    const metadata = { id: "next", label: "Authored next", direction: { headingDeg: 33, pitchDeg: 2 }, arrivalView: { headingDeg: 8, pitchDeg: -4, verticalFovDeg: 70 } };
    west.entities[0].links.push({ ...metadata, target: "b-1", externalDestination: "east-route" });
    f.repin("west");
    f.request.links = [{ from: { child: "west", id: "a-1" }, to: { child: "east", id: "b-1" }, consume: "next", link: metadata, insert: { before: "local" } }];
    return f;
  };
  it("consumes a declared crossing once, preserves metadata and puts next before previous", () => {
    const f = crossing(), before = [...f.documents.values()].reduce((n, d) => n + d.entities.reduce((m, e) => m + e.links.length, 0), 0);
    const result = prepare(f, { limits: { links: before } }), links = result.document.entities.find(e => e.id === "a-1").links;
    assert.deepEqual(links.map(l => l.id), ["next", "local"]);
    assert.deepEqual(links[0], { ...f.request.links[0].link, target: "b-1" });
    assert.equal(result.document.entities.reduce((n, e) => n + e.links.length, 0), before);
    assert.deepEqual(result.provenance.linkMappings, [{ child: "west", entityId: "a-1", linkId: "next", to: { child: "east", id: "b-1" }, consumed: true }]);
    assert.equal(f.documents.get("west").entities[0].links[1].externalDestination, "east-route");
    delete f.request.links[0].insert;
    assert.deepEqual(prepare(f).document.entities.find(e => e.id === "a-1").links.map(l => l.id), ["local", "next"]);
  });
  it("supports bounded after/index insertion and keeps default append", () => {
    const f = createCompositionFixture(); f.request.links[0].from.id = "a-1";
    assert.deepEqual(prepare(f).document.entities.find(e => e.id === "a-1").links.map(l => l.id), ["local", "cross"]);
    f.request.links[0].insert = { index: 0 };
    assert.deepEqual(prepare(f).document.entities.find(e => e.id === "a-1").links.map(l => l.id), ["cross", "local"]);
    f.request.links[0].insert = { after: "local" };
    assert.deepEqual(prepare(f).document.entities.find(e => e.id === "a-1").links.map(l => l.id), ["local", "cross"]);
  });
  it("rejects missing anchors, contradictory edits, altered consumed metadata and wrong destinations", () => {
    for (const insert of [{ before: "absent" }, { index: -1 }, { index: 100 }, { before: "local", after: "local" }]) {
      const f = crossing(); f.request.links[0].insert = insert; assert.throws(() => prepare(f));
    }
    const repeat = crossing(); repeat.request.links.push(structuredClone(repeat.request.links[0])); failure(repeat, "collision");
    const drift = crossing(); drift.request.links[0].link.label = "Changed"; failure(drift, "drift");
    const wrong = crossing(); wrong.request.links[0].to.id = "b-2"; failure(wrong, "reference");
    const local = crossing(); local.request.links[0].consume = "local"; failure(local, "collision");
  });
  const replacement = () => {
    const f = createCompositionFixture(); f.request.links = []; delete f.request.groupOrder;
    const group = { id: "earlier", title: "Earlier authored stops", extensions: { "example.tour": { note: "Original note", stops: ["b-1", "a-2", "a-1", "b-2"] } } };
    f.request.groupReplacements = [{ consume: [{ child: "west", id: "a-group" }, { child: "east", id: "b-group" }], group,
      members: [{ child: "east", id: "b-1" }, { child: "west", id: "a-2" }, { child: "west", id: "a-1" }, { child: "east", id: "b-2" }], contextChild: "west" }];
    f.extensions.push({ name: "example.tour", validation: { name: "example.tour", validateDocument: value => ({ data: value, warnings: [] }) }, composeDocument: () => ({}), rewrite: (value, context) => {
      assert.equal(context.scope, "group"); assert.equal(context.child.key, "west"); assert.equal(context.child.resolveId("groups", "a-group"), "earlier"); return value;
    } });
    return f;
  };
  it("replaces two named child groups with one ordered mixed group and explicit provenance", () => {
    const f = replacement(), result = prepare(f);
    assert.deepEqual(result.document.groups, [{ ...f.request.groupReplacements[0].group, members: ["b-1", "a-2", "a-1", "b-2"] }]);
    assert.deepEqual(result.provenance.groupReplacements, [{ outputId: "earlier", consumed: f.request.groupReplacements[0].consume, members: f.request.groupReplacements[0].members }]);
    assert.deepEqual(result.provenance.aliases.filter(a => a.kind === "groups").map(a => [a.child, a.originalId, a.outputId]), [["west", "a-group", "earlier"], ["east", "b-group", "earlier"]]);
    f.request.groupOrder = [{ composed: "earlier" }]; assert.equal(prepare(f).document.groups.length, 1);
    assert.equal(f.documents.get("west").groups[0].id, "a-group");
  });
  it("rejects lossy/repeated replacement membership and requires explicit extension ownership/context", () => {
    const lossy = replacement(); lossy.request.groupReplacements[0].members.pop(); failure(lossy, "reference");
    const repeat = replacement(); repeat.request.groupReplacements[0].consume.push({ child: "west", id: "a-group" }); failure(repeat, "collision");
    const context = replacement(); delete context.request.groupReplacements[0].contextChild; failure(context, "owner-required");
    const opaque = replacement(); opaque.extensions.pop(); failure(opaque, "owner-required");
    const alias = replacement(); alias.request.children[0].aliases = { groups: { "a-group": "contradiction" } }; failure(alias, "collision");
    const order = replacement(); order.request.groupOrder = [{ child: "west", id: "a-group" }]; failure(order, "reference");
  });

});
