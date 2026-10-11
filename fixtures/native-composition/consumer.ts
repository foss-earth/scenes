import type { ExternalDestinationRecord } from "@foss-earth/scenes";
import type { LoadSceneOptions, SceneExternalNavigationPorts } from "@foss-earth/scenes/browser";
import { composeSceneDocuments, type SceneCompositionRequest, type SceneCompositionOptions, type SceneCompositionGroupReplacement, type SceneCompositionLink } from "@foss-earth/scenes/composition";
import { composeScenes } from "@foss-earth/scenes/composition-node";
const destination: ExternalDestinationRecord = { id: "next-route", sceneId: "next-scene", routeId: "next-tour" };
const navigation: SceneExternalNavigationPorts = { async navigate(input) { const route: string | undefined = input.destination.routeId; const arrival = input.link.arrivalView; const source: string = input.source.panoramaId; const signal: AbortSignal = input.signal; void [route, arrival, source, signal]; return { ok: true }; } };
const replacement: SceneCompositionGroupReplacement = { consume: [{ child: "one", id: "old" }, { child: "two", id: "old" }], group: { id: "mixed", title: "Earlier stops" }, members: [{ child: "one", id: "stop" }, { child: "two", id: "stop" }] };
const link: SceneCompositionLink = { from: { child: "one", id: "stop" }, to: { child: "two", id: "stop" }, consume: "next", link: { id: "next", label: "Next" }, insert: { before: "previous" } };
declare const options: SceneCompositionOptions;
declare const request: SceneCompositionRequest;
declare const host: LoadSceneOptions;
host.externalNavigation = navigation;
const result = composeSceneDocuments({ ...request, links: [link], groupReplacements: [replacement], groupOrder: [{ composed: "mixed" }] }, options);
void [destination, result.provenance.linkMappings, result.provenance.groupReplacements, composeScenes];
// @ts-expect-error Host resolution requires a declared scene identity.
const invalid: ExternalDestinationRecord = { id: "missing", routeId: "route" };
void invalid;
