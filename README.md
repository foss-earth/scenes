# @foss-earth/scenes

Local `0.1.0` staging extraction from immutable Earth `90e23b3`. The package owns the version-one scene envelope, references, authored ordering, capture/marker/overview records, groups/links, manifest validation/input, replacement/history/controller and Scenes presentation. It imports common image records and checks from `@foss-earth/images`. It creates no renderer, image broker, cache, upload queue, camera clock or feature application.

This is the independent `foss-earth/scenes` checkout. In an organization-grouped
workspace it lives beside `360`, `images`, `preview-sheets`, `tiled-cubemap` and
the `foss-earth.github.io` application. Use those providers' public package
exports through the shared installer source/package/hybrid selection contract;
the group directory itself is not a repository. The retained pre-split Earth
application is a read-only recovery input. It is not a dependency or a second
copy of this source. Current relocated source and installed links require a
fresh granted qualification; earlier logs retain their original paths and scope.


The pure root exports scene records, `validateScene`, `composeSceneSchema`, `SCENES_TAB`, the four existing `SCENE_DOCUMENT_PARAMETERS` and Content/Credits section titles. A host supplies `RepresentationHooks[]`, `validateImageAsset(asset,{path})`, optional extension hooks and named byte/count limits. Unknown projections are skipped with warnings; optional unknown entities remain in authored list order and links to them are disabled; required unsupported entities/extensions fail. Version1, errors, style inheritance, unknown capture height, north alignment, reference checks and base-URL resolution preserve source behavior. No spatial representation definition or built-in catalogue lives here.

`./schema.json` is the v1 envelope/common-metadata schema. `composeSceneSchema` adds explicit owner `$ref` registrations. It does not fetch schemas. The envelope alone cannot qualify a cube, image aspect ratio, tiled hierarchy, sheet or viewer preview policy. Runtime ownership hooks and viewer policy are authoritative. The optional `@foss-earth/preview-sheets/scene-extension` entry supplies `createPreviewSheetsExtensionHook()` without importing this package.

`./browser` exports `resolveSceneInput`, `fetchSceneManifest`, `sceneManifestUrl`, `loadScene`, `createSceneController`, browser/memory history and structural ports. Transports and browser targets are explicit. Manifest requests omit credentials, refuse URL credentials/non-HTTP protocols, bound arriving uncompressed bytes, close failed/cancelled bodies and resolve image URLs against the final redirect URL. Programmatic JSON needs no transport. There is no implicit document base, application settings, example catalogue or identity.

`loadScene(input,options)` validates before owner work. The host supplies one360 viewer binding, engine-owned geography/navigation ports, its current radius setting and history session identity. Scenes passes each image's asset, pose, resolved placement/content, title/credits/view and action callbacks; it resolves link destinations itself. `viewer.prepare` prepares hidden metadata without waiting for every preview, `replaceImages` atomically publishes metadata and the viewer reveals only ready images. Outgoing entries dispose immediately after successful publication. A validation/prepublication failure preserves the prior scene; postpublication preview failure stays listed unavailable. Superseded/disposed late owner preparations are closed, and placement watches/history subscriptions are removed. The host must give this scene binding its own namespace when multiple scenes share a renderer.

`SceneWorldPorts.resolvePlacement` reads the displayed-ground snapshot synchronously, preserving `marker:null` and `state:"pending"` when missing. `watchPlacement` reports later engine-ground revisions; Scenes supplies no duplicate ECEF/ENU math. `showOverview` delegates ground preparation and camera motion to the engine port, which must preserve interrupted momentum and user-input handover. `frames.subscribe` and `projectLink` are optional existing renderer/viewer overlay ports; Scenes starts no animation loop. `describeImage` passes owner observations into the existing preview/details status, without recomputing format dimensions or budgets. The360 binding owns input, transitions and active-image detail; image progress/failure ports are wired by the host when constructing that binding.

`SceneViewerStatus.immersionDetail` is an optional structural observation from
the supplied viewer. Its representation, loading, limitation and optional
progress fields match the public viewer reading without importing its
implementation. `SceneStatus` passes the published reading through unchanged
on viewer notifications. `null` stays cleared and an omitted reading stays
absent; Scenes derives no replacement reading from a target or asset metadata.

The app controller loads explicit URLs or registered example IDs, cancels old loads, cleans stale successful handles and implements source click/tap rules using an injected drag threshold. It does not consume gestures, keyboard controls or shareable arbitrary URLs. `./panel` requires an explicit Document and shared UI/settings port. It retains source Content, Credits, entity details, groups, unavailable entries and authored directional hotspot buttons. Other owners contribute Orbs, Motion, Loading, Tiles and Saved sections at existing `scenes.*` homes. The host keeps active `panorama` and `panorama-settings` tabs with360 and HUD/toolbar composition with their owners. Import `./panel.css` together with the shared UI base styles.

`./browser` also exports `createSavedImagesSection({document, source, refresh,
maxListedGroups})`. `source` is `Pick<MediaStore,"inspect"|"clear">` from the
actual public `@foss-earth/images` contract. The host supplies its existing
store; Scenes creates no cache or storage policy. Counts, storage usage,
availability/refusal/zero-limit text, reused/added visit totals, group ordering
and clear explanations retain the original presentation. Images' inspection
returns groups by most recent use; presentation retains that order.
`maxListedGroups()` is a required named host-visible Scenes/Saved images count
policy, a nonnegative whole number. Binding it to 60 preserves the original
list length. Registration of that policy in the canonical shared settings
catalogue remains host integration work. No existing saved-storage budget is
repurposed as a display limit.

The supplied `refresh.subscribe` is the shared UI refresh authority. Its host
policy should preserve the former 2000 ms cadence when adopting this section;
Scenes starts no interval or clock. It performs one initial inspection, then
inspects on host notifications only while connected and its containing section
is open. A clear blocks repeated clear/refresh work and invalidates older
inspection results. Later inspections cannot be overwritten by older successes
or failures. Destruction marks stale first, detaches actions/subscription and
element once, and suppresses late inspect/clear completion or failure; cleanup
failures are reported together. A native clear already submitted to Images
continues under that owner's authority and is not undone by closing the panel.
The section retains the shared note/action/cache class names; adoption must
provide their existing base/cache styles. Current UI source now includes the
original shared cache summary/list/progress rules through its public
`@foss-earth/ui/styles.css` export. Adoption requires that new checked UI
archive and stylesheet; the earlier frozen UI artifact does not qualify the
added cache styles. Their installed appearance remains unverified.

`connectSceneLog(controller, log)` binds scene-specific formatting to supplied
public UI `GameLog` ports and structural `SceneLogController` subscriptions.
Its UI import is type-only; no log, DOM, timer or polling starts on browser
import. It preserves manifest bytes, aggregated usable-preview progress,
unavailable/failure diagnostics, cancelled bars and completed image
`keepInHistory:false` behavior. UI owns log expiry/history/timers. Detach marks
stale, attempts every subscription and unfinished-line release despite failure,
and is idempotent; held callbacks cannot republish. A later registration failure
rolls back earlier subscriptions. Optional UI declarations are pinned to 0.1.0;
the full consumer/test closure needs the checked current UI archive.

The three original Saved images and nine original scene-log cases retain their
assertion bodies in `tests/savedImagesSection.test.ts` and
`tests/sceneLog.test.ts`. Setup now calls actual public owner/UI factories with
explicit ports. Additional causal fixtures cover ordering, closed sections,
supplied Document, destruction during clear/inspect, throwing detach and
registration rollback. They are all UNRUN. The scene-log transport fixtures
exercise invalid manifests with public transport/controller ports; they do not
qualify a valid rendered scene or replace the 42 pending mixed lifecycle
obligations recorded in the existing composition ledger. The default tab map
and existing Scenes/Saved contribution remain unchanged.

The immutable original [panorama-scene proposal](docs/proposals/panorama-scenes.md)
is retained with its exact source/blob/destination mapping in `SOURCE_PLAN.json`.
Its dated evidence, staged proposals and legacy paths remain original prose;
the repository-split ownership and current public contracts above govern this
source candidate. Original relative evidence/research links are preserved;
their final cross-owner publication routing remains coordinator work. Copying
the prose adds no implemented capability, successful experiment or device claim.

`tests/fixtures/proposal-example.scene.json` retains the original full source manifest. Envelope tests supply a neutral test owner; spatial fixtures stay with format owners. `fixtures/360-consumer.ts` uses only public360/preview/scenes declarations and demonstrates the actual structural interface. Tests cover envelope/schema/limits/URLs, progressive readiness, prepublication preservation, stale cleanup, history, controller pointers and injected panel lifecycle. Source-only candidate: no install, check, build, pack, real app adoption, GPU/device qualification or published artifact is claimed yet. Exact tool versions are pinned; incremental checks keep their caches and cap Vitest at50% workers. A granted check window must run `npm run ci` once, then only affected failure steps, and an offline isolated installed-artifact/type consumer.

Source blobs, SHA256 values and transformation routes are in `SOURCE_PROVENANCE.json`. The exact primary-generated CI9e caller/scaffold is preserved; complete accepted lineage, installed shared conformance, public caller availability and actual remote admission remain pending. See `docs/admission.md`. Rollback retains the read-only original application archive, earlier artifacts and their dirty/ignored evidence. Primary composes the independent `foss-earth.github.io` application through checked public exports; this owner does not retire or mutate the archive. No source history, commit attribution or remote admission settings are changed by this source preparation.

The pure root also exports `checkSceneFiles(scene, read, options)` with explicit
representation file/group and opaque extension file hooks. `./node` binds the
public built-in owners, retaining the original two-argument checker and
`foss-earth-check-scene` publication CLI. See `docs/node-checker.md`.

`./preview-sheets` exports `buildScenePreviewSheets(manifestPath, {faceSize?,
quality?, maxPixels?})`. `foss-earth-build-preview-sheets` retains the original
inline/separate arguments, help status, output wording and unchanged host scene
revision. It composes the actual public preview packer and cube file enumerator,
without owning a leaf schema or pixel algorithm. Before mutation it checks the
manifest, decoded input URLs, generated paths and existing parent symlinks
against the local scene folder. It refuses output collisions with the manifest
or original cube inputs, preserves originals even when their cube is unselected,
and removes only obsolete local sheets. No media is fetched. Legacy preparation
records migrate through the preview owner; runtime optional-extension fallback
continues to use the six originals. These source guards do not promise atomic
multi-file publication, hard-link alias detection or protection against another
process changing the filesystem between validation and mutation.

`npm run ci` invokes the installed common `check:conformance`, then the preserved
`check:implementation` chain. The actual accepted CI9e archive must be installed
and match `.attribution-release.json`; there is no copied checker or inferred
owner result. `scripts/check-isolated-archive.mjs` requires a complete exact
archive/digest closure and runs workspace-installed runtime and compiler tools
with realpath guards and negative controls. Public schema/CSS, both Node entries,
both CLI/bin routes and Scenes/360 declaration composition are included. See
`docs/installed-consumer.md` for mandatory pins and queued commands. All checks,
artifacts and actual application adoption for this increment remain UNRUN.

## Project policies

- [Code of conduct](https://github.com/foss-earth/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/foss-earth/.github/blob/main/CONTRIBUTING.md)
- [AGPL-3.0 license](LICENSE)
- [Security](https://github.com/foss-earth/.github/blob/main/SECURITY.md)
