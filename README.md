# @foss-earth/scenes

The version-one scene format for FOSS Earth, and the code that loads and presents scenes. A scene is a manifest of images (spheres and photos) placed on the globe, with captures, markers, overviews, groups and links between them.

This package owns the scene envelope, references, authored ordering, capture, marker and overview records, groups and links, manifest validation and input, scene replacement, history, the scene controller and the Scenes panel. It imports common image records and checks from [images](https://github.com/foss-earth/images). It creates no renderer, image broker, cache, upload queue, camera clock or feature application.

It works with these repositories, whose public exports a host app uses directly:

- [360](https://github.com/foss-earth/360): the image viewer a scene is shown in.
- [images](https://github.com/foss-earth/images), [preview-sheets](https://github.com/foss-earth/preview-sheets), [tiled-cubemap](https://github.com/foss-earth/tiled-cubemap) and [cubemap](https://github.com/foss-earth/cubemap): image records, preview sheets and spatial formats. No spatial representation definition or built-in catalogue lives here.
- [ui](https://github.com/foss-earth/ui): shared panel and settings surface (optional peer).
- The [application](https://github.com/foss-earth/foss-earth.github.io) composes them.

## Exports

| Entry | Contents |
| --- | --- |
| `.` | Scene records, `validateScene`, `composeSceneSchema`, `checkSceneFiles`, `SCENES_TAB`, `SCENE_DOCUMENT_PARAMETERS`, Content and Credits section titles |
| `./schema.json` | The v1 envelope and common-metadata JSON schema |
| `./browser` | `resolveSceneInput`, `fetchSceneManifest`, `sceneManifestUrl`, `loadScene`, `createSceneController`, `createSavedImagesSection`, `connectSceneLog`, browser and memory history, structural ports |
| `./panel`, `./panel.css` | The Scenes panel and its styles. Import the CSS together with the shared UI base styles. |
| `./composition`, `./composition-node` | Scene composition. See [docs/scene-composition.md](docs/scene-composition.md). |
| `./node` | The Node scene checker (two-argument form) |
| `./check-cli` | The `foss-earth-check-scene` command |
| `./preview-sheets` | `buildScenePreviewSheets` |
| `./build-preview-cli` | The `foss-earth-build-preview-sheets` command |

## Scene validation

A host supplies `RepresentationHooks[]`, `validateImageAsset(asset, {path})`, optional extension hooks and named byte and count limits.

- Unknown projections are skipped with warnings.
- Optional unknown entities stay in authored list order, and links to them are disabled.
- Required unsupported entities or extensions fail.

The same rules cover errors, style inheritance, unknown capture height, north alignment, reference checks and base-URL resolution.

`composeSceneSchema` adds explicit owner `$ref` registrations to the envelope schema. It does not fetch schemas. The envelope alone cannot validate a cube, an image aspect ratio, a tiled hierarchy, a sheet or a viewer preview policy. The runtime hooks and viewer policy are authoritative. The optional `@foss-earth/preview-sheets/scene-extension` entry supplies `createPreviewSheetsExtensionHook()` without importing this package.

`checkSceneFiles(scene, read, options)` takes explicit representation file and group hooks and opaque extension file hooks. `./node` binds the public built-in owners and keeps the two-argument checker and the `foss-earth-check-scene` CLI. See [docs/node-checker.md](docs/node-checker.md).

## Loading scenes in the browser

`./browser` has explicit transports and browser targets. There is no implicit document base, application settings, example catalogue or identity.

- Manifest requests omit credentials, refuse URLs with credentials and non-HTTP protocols, bound the uncompressed bytes that arrive, close failed or cancelled bodies, and resolve image URLs against the final redirect URL.
- Programmatic JSON needs no transport.

`loadScene(input, options)` validates before any owner work. The host supplies:

- one 360 viewer binding,
- engine-owned geography and navigation ports,
- its current radius setting,
- a history session identity.

Scenes passes each image's asset, pose, resolved placement and content, title, credits, view and action callbacks to the viewer, and resolves link destinations itself. `viewer.prepare` prepares hidden metadata without waiting for every preview. `replaceImages` publishes the metadata atomically, and the viewer reveals only ready images. Outgoing entries are disposed right after a successful publication.

- A validation or pre-publication failure keeps the prior scene.
- A preview failure after publication leaves the image listed as unavailable.
- Superseded or disposed late preparations are closed, and placement watches and history subscriptions are removed.
- When several scenes share a renderer, the host must give each scene binding its own namespace.

World ports:

- `SceneWorldPorts.resolvePlacement` reads the displayed-ground snapshot synchronously, and keeps `marker: null` and `state: "pending"` when it is missing.
- `watchPlacement` reports later engine-ground revisions. Scenes has no ECEF/ENU math of its own.
- `showOverview` delegates ground preparation and camera motion to the engine port, which must preserve interrupted momentum and user-input handover.
- `frames.subscribe` and `projectLink` are optional overlay ports of the renderer or viewer. Scenes starts no animation loop.
- `describeImage` passes the owners' observations into the preview and details status, without recomputing format dimensions or budgets.

The 360 binding owns input, transitions and active-image detail. The host wires image progress and failure ports when it builds that binding.

`SceneViewerStatus.immersionDetail` is an optional structural observation from the supplied viewer. Its representation, loading, limitation and optional progress fields match the public viewer reading without importing its implementation. `SceneStatus` passes the reading through unchanged on viewer notifications. `null` stays cleared and an omitted reading stays absent. Scenes derives no reading from a target or from asset metadata.

## Controller and panel

The app controller loads explicit URLs or registered example IDs, cancels old loads, cleans up stale successful handles, and applies source click and tap rules using an injected drag threshold. It does not handle gestures, keyboard controls or shareable arbitrary URLs.

`./panel` needs an explicit Document and the shared UI and settings port. It provides Content, Credits, entity details, groups, unavailable entries and directional hotspot buttons. Other owners contribute the Orbs, Motion, Loading, Tiles and Saved sections at their `scenes.*` homes. The host keeps the `panorama` and `panorama-settings` tabs with 360, and the HUD and toolbar composition with their owners.

### Saved images section

`createSavedImagesSection({document, source, refresh, maxListedGroups})` shows what the image store holds. `source` is `Pick<MediaStore, "inspect" | "clear">` from the public `@foss-earth/images` contract. The host supplies its store. Scenes creates no cache or storage policy.

- It shows counts, storage use, availability, refusal and zero-limit text, reused and added visit totals, group order (most recently used first) and clear explanations.
- `maxListedGroups()` is required: a nonnegative whole number, the count of groups listed. The previous app list length was 60. Registering this policy in the shared settings catalogue is up to the host. It is not a storage budget.
- `refresh.subscribe` is the shared UI refresh authority. The earlier app refreshed every 2000 ms. Scenes starts no interval or clock.
- The section inspects once at the start, then on host notifications only while it is connected and its section is open.
- A clear blocks repeated clear and refresh work and invalidates older inspection results. An older inspection never overwrites a later one.
- Destroying the section marks it stale, detaches its actions, subscription and element once, and suppresses late inspect or clear results and failures. Cleanup failures are reported together. A clear already submitted to Images continues there, and closing the panel does not undo it.
- It uses the shared note, action and cache class names, so the host needs the shared cache summary, list and progress styles from `@foss-earth/ui/styles.css`.

### Scene log

`connectSceneLog(controller, log)` binds scene-specific formatting to the public UI `GameLog` ports and structural `SceneLogController` subscriptions. The UI import is type-only, and nothing (log, DOM, timer or polling) starts on import. It shows manifest bytes, aggregated usable-preview progress, unavailable and failure diagnostics, cancelled bars, and completed images with `keepInHistory: false`. UI owns log expiry, history and timers. Detach marks the connection stale, attempts every subscription and unfinished-line release even if one fails, and can be called repeatedly. Held callbacks cannot republish. A registration failure rolls back the earlier subscriptions.

## Preview sheets

`buildScenePreviewSheets(manifestPath, {faceSize?, quality?, maxPixels?})` from `./preview-sheets`, and the `foss-earth-build-preview-sheets` command, build preview sheets for a scene's cube images. The command takes inline or separate arguments, and leaves the host scene revision unchanged. It uses the public preview packer and cube file enumerator, and defines no schema or pixel algorithm of its own.

- Before changing anything it checks the manifest, decoded input URLs, generated paths and existing parent symlinks against the local scene folder.
- It refuses output collisions with the manifest or the original cube inputs, and keeps the originals even when their cube is unselected.
- It removes only obsolete local sheets. No media is fetched.
- Older preparation records migrate through the preview-sheets package. At runtime, optional-extension fallback uses the six original files.

Limits: it does not promise atomic multi-file publication, hard-link alias detection, or protection against another process changing the filesystem between validation and writing.

## Documentation

- [Scene composition](docs/scene-composition.md)
- [Navigation](docs/navigation.md) and [navigation lifecycle](docs/navigation-lifecycle.md)
- [Node checker](docs/node-checker.md)
- [Sphere scenes proposal](docs/proposals/panorama-scenes.md): the original design proposal, kept as written. Its dated evidence, staged proposals and old paths are historical. This README describes the current contracts.

Tests cover the envelope, schema, limits and URLs, progressive readiness, preservation of the prior scene on pre-publication failure, stale cleanup, history, controller pointers and the injected panel lifecycle. `tests/fixtures/proposal-example.scene.json` is the full example manifest from the proposal. Envelope tests use a neutral test owner, and spatial fixtures live with the format libraries. `fixtures/360-consumer.ts` uses only public 360, preview-sheets and scenes declarations.

## Development

This package depends on other `@foss-earth/*` libraries by versions that are not published, so its own `npm install`, tests and build do not work on their own yet. Libraries are developed through the app, which uses them straight from their checkouts. See [local source](https://github.com/foss-earth/app#local-source).

## Project policies

- [Code of conduct](https://github.com/foss-earth/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/foss-earth/.github/blob/main/CONTRIBUTING.md)
- [AGPL-3.0 license](LICENSE)
- [Security](https://github.com/foss-earth/.github/blob/main/SECURITY.md)
