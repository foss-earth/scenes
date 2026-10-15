import assert from "node:assert/strict";
import { composeScenes, builtInSceneCompositionOwners } from "@foss-earth/scenes/composition-node";
import { validateScene } from "@foss-earth/scenes";
import { loadScene } from "@foss-earth/scenes/browser";
import { validateViewerAsset } from "@foss-earth/sphere-image";
import { createCompositionFixture } from "./release-composition.fixture.mjs";

const fixture = createCompositionFixture(), west = fixture.documents.get("west"), east = fixture.documents.get("east");
const metadata = { id: "next-tour", label: "Next authored stop", direction: { headingDeg: 27, pitchDeg: 3 }, arrivalView: { headingDeg: 5, pitchDeg: 1, verticalFovDeg: 60 } };
west.externalDestinations = [{ id: "other-tour", sceneId: east.id, routeId: "east-route" }];
west.entities[0].links.push({ ...metadata, target: "b-1", externalDestination: "other-tour" }); fixture.repin("west");
fixture.request.links = [{ from: { child: "west", id: "a-1" }, to: { child: "east", id: "b-1" }, consume: metadata.id, link: metadata, insert: { before: "local" } }];
fixture.request.groupReplacements = [{ consume: [{ child: "west", id: "a-group" }, { child: "east", id: "b-group" }], group: { id: "earlier-stops", title: "Earlier stops" }, members: [{ child: "west", id: "a-1" }, { child: "east", id: "b-2" }, { child: "west", id: "a-2" }, { child: "east", id: "b-1" }] }];
fixture.request.groupOrder = [{ composed: "earlier-stops" }];
const aggregate = composeScenes(fixture.request, { inputs: fixture.inputs });
assert.equal(aggregate.document.entities.length, 4); assert.equal(aggregate.document.groups.length, 1);
assert.equal(aggregate.document.entities.reduce((n, e) => n + e.links.length, 0), 3);
assert.deepEqual(aggregate.document.entities.find(e => e.id === "a-1").links, [{ ...metadata, target: "b-1" }, west.entities[0].links[0]]);
assert.deepEqual(aggregate.document.groups[0].members, ["a-1", "b-2", "a-2", "b-1"]);
assert.equal(aggregate.provenance.groupReplacements[0].consumed.length, 2);
const validation = { baseUrl: fixture.request.children[0].media.baseUrl, representations: builtInSceneCompositionOwners(), validateImageAsset: validateViewerAsset };
const standalone = validateScene(west, validation); assert.equal(standalone.ok, true);
let status = { phase: "overview", active: null, target: null }, received = null;
const result = await loadScene(west, { ...validation, sessionId: "installed-external", markerRadiusMeters: () => 1,
  world: { resolvePlacement: () => ({ state: "pending", placement: { marker: null, radiusMeters: 1, content: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } }),
    showOverview: async () => ({ ok: true, state: "pending" }) },
  viewer: { prepare: async input => ({ id: input.id, ready: async () => {}, updatePlacement() {}, hover() {}, dispose() {} }), replaceImages() {}, setMapVisibility() {}, enter: async id => { status = { phase: "immersive", active: id, target: null }; return true; }, exit() {}, status: () => status, subscribe: () => () => {}, pick: () => [], hover() {} },
  externalNavigation: { navigate: async input => { received = input; return { ok: true }; } } });
assert.equal(result.ok, true); await result.handle.whenSettled(); await result.handle.enter("a-1");
assert.deepEqual(await result.handle.follow(metadata.id), { ok: true }); assert.equal(received.destination.routeId, "east-route"); assert.equal(received.sphereId, "b-1"); assert.equal(received.source.sphereId, "a-1"); assert.deepEqual(received.link.arrivalView, metadata.arrivalView);
result.handle.dispose(); await result.handle.whenSettled();
process.stdout.write("Installed Scenes external navigation, authored link consumption/order and mixed-group replacement passed.\n");
