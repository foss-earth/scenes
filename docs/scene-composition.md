# Checked scene composition

Prepared 2026-10-10, source only. The new implementation, declarations, fixtures
and installed consumer have not run. No new package/revision or Campus adoption
is claimed. The current checked Scenes d58408d release does not contain these
exports. Qualification requires the separate shared verification grant.

`@foss-earth/scenes/composition` exports `composeSceneDocuments`, its input,
owner-port, result and limit types, and `SceneCompositionError`. The root barrel
also exports this pure API. `@foss-earth/scenes/composition-node` exports
`composeScenes` and `builtInSceneCompositionOwners`. The Node adapter supplies
standard SHA-256 and the existing public cube, equirectangular and tiled-cube
validators/serializers/file hooks through the supplied 360 catalogue. Neither
entry creates a filesystem reader, fetch, DOM, image viewer, renderer, device,
world, controller, render loop, timer or server.

The producer emits one ordinary version-one scene. Existing v1 loaders read
its absolute media references and deliberate navigation; no runtime include
mechanism or second scene authority is introduced. Envelope/placements and
navigation remain Scenes-owned. Spatial records, sheets, codecs, common image
services and the active viewer retain their existing owners.

## Explicit input pins

A `SceneCompositionRequest` names parent ID/revision/title, ordered child keys,
each child's final immutable manifest URL/ID/revision/SHA-256/byte count, its
independently pinned media index and declared media base, a complete entity-order
permutation, optional group-order permutation, initial panorama, authored
overview, reversible envelope ID aliases and deliberate cross-child links.
There are no inferred campus names, memberships, credits, geographic groups,
overview, initial panorama or external link destinations. Omitted group order
preserves child order and the groups within each child. Omitted overview leaves
the host's existing view behavior intact.

The media index is a UTF-8 JSON integrity list owned by this preparation
contract, not a spatial image format:

```json
{
  "format": "foss-earth-scene-media",
  "version": 1,
  "id": "child-media",
  "revision": "immutable-media-r1",
  "files": [
    { "url": "faces/px.png", "sha256": "<actual SHA-256>", "sizeBytes": 123 }
  ]
}
```

Each file has its actual pin; the example digest is explanatory, not a usable
release. Relative file pins resolve against the declared child media base.
The child's image, attribution and extension owner hooks receive that same
explicit base. To use the final manifest's directory, explicitly supply its
final URL as `media.baseUrl`. Manifest/index/file URLs must be credential-free
HTTP(S) URLs without fragments. Requested redirect URLs are not final bindings.
The host acquires bytes using its own bounded transport/file resolver, verifies
the final URL and retains acquisition/cleanup receipts. It supplies a
`ReadonlyMap<string, Uint8Array>` keyed by those exact final URLs. This pure
facility cannot attest to HTTP redirect or filesystem-origin behavior.

All indexed files are checked, including unused files in the declared release.
Use an independently pinned index of the intended child release, with explicit
shared immutable asset-release URLs where required. Every referenced file must
belong to that child's index. One shared URL must have identical digest and
length in all children; conflicting pins fail. Complete media/header totals and
owner-supplied content/equivalence checks run against verified byte snapshots.
File pinning does not claim decoded pixels are semantically identical: sheet
equivalence remains the explicit preview-sheet owner's verifier responsibility.

The pure entry needs an explicit SHA-256 function and representation/support
owners. The Node route supplies those built-ins and the public Preview owner:

```ts
import { composeScenes } from "@foss-earth/scenes/composition-node";

const result = composeScenes(request, {
  inputs: acquiredExactBytes,
  // The Node default uses the actual checked Preview owner.
  previewSheets: { verificationLimits: reviewedPreviewLimits },
  limits: reviewedFiniteLimits,
  signal: preparationAbortSignal,
});
// Host publishes result.manifest only after all checks/admission succeed.
// result.provenance supplies child/media pins, aliases, asset mappings and
// unique referenced files. No child image bytes are copied into the manifest.
```

The builder snapshots input bytes, checks byte counts/digests before parsing,
checks child ID/revision and media-index identity, validates each child and the
combined v1 envelope, and uses the existing public image-header/file checker.
Unregistered representations and discarded optional media/extension records
fail explicitly. Inert unsupported optional entity records remain unchanged and
reported, can remain in authored groups/order, cannot be aliased, and cannot be
link or initial-panorama destinations. Their private payload is never traversed.

## IDs, ordering and navigation

Unique authored asset/entity/group IDs are retained. A collision fails until the
author supplies explicit aliases for the affected child and ID scope. Aliases
must name existing records and be globally injective within their scope. The
result records original/output IDs and child keys, so mapping is reversible.
One asset used by multiple stops remains one asset; a shared media URL is
verified once. Different asset definitions are not silently deduplicated based
on titles, coordinates, pixels or IDs. Colliding definitions may be explicitly
aliased while continuing to reference the same pinned media.

Each child must be valid standalone v1: local links name its supported
panoramas. A parent link names `from: {child, id}`, `to: {child, id}` and the
authored link fields except `target`. It appends in request order, uses the
normal v1 target field after mapping and cannot replace an existing source link
with the same ID. Unresolved external/local links fail; no link is silently
dropped. The Campus author must partition local navigation and explicitly carry
the four deliberate cross-campus links into its aggregate request. Scenes does
not make that editorial decision or alter the legacy published document.

Captions, credits, unknown/absent heights, north/pose/alignment, capture and marker
offsets, link direction/arrival view and group memberships are preserved. Child
root marker style is materialized onto each marker, property by property with
its existing overrides/nulls, because the combined document has one root style.
The aggregate's own initial panorama and overview are explicitly authored.

## Extension owner boundary and required handoff

Every present extension, optional or required, needs a
`SceneCompositionExtensionOwner`. Existing viewer tolerance of an unknown
extension does not establish how to merge/rebase it during publication. An
owner supplies its existing validation hook, `composeDocument` for merging root
records and explicit extension aliases/state, `rewrite` for each known envelope
attachment, `files` for declared image files and, where relevant, `verifyFiles`
for content/equivalence. Hooks receive the child's own base, reversible envelope
ID resolver, authored path, bounded limits and cancellation context. The owner
must honor those bounds and serialize only its own publishable extension fields.
Scenes never walks arbitrary nested `url`, `target` or `id` fields, guesses an
extension schema or publishes the owner's private state/runtime fields.

The Node route uses `@foss-earth/preview-sheets/composition-node` through
`builtInSceneCompositionExtensions` by default. The pure route accepts
`createPreviewSheetsCompositionOwner` from the public Preview composition
entry or the Node owner when content verification is required. Neither leaf
imports Scenes. Explicit `extensions: []` still declines the owner and fails
when sheet metadata is present.

Preview resolves child bases through public validators, rejects discarded
optional metadata, deduplicates identical immutable records and requires
explicit reversible `previewSheets.aliases` for conflicting sheet identities.
It preserves cells and original six faces and emits no runtime `sheet`.
Its required verifier accounts for retained decoded sheets plus temporary
Images decoder/face reservations, and bounds encoded input, pixels and work.
`previewSheets.verificationLimits` and `minPsnrDb` configure those leaf-owned
limits. Synchronous cancellation cannot interrupt active native decoding.

`fixtures/composition/release-composition.fixture.mjs` contains tiny authored
content and uses the actual production owner export. The historical five-row
fixture-adapter request remains unexecuted and preserved as evidence. Exact
local source/archive/closure/strict runtime/types/ref receipts are recorded
under `build/repository-split/checks/2026-10-10-preview-scenes-qualified-delivery`.
No Campus application or media publication is implied by local qualification.

## Bounds, failure and reproducibility

Defaults bound request/manifest/index bytes, children/entities/assets/groups/
links/representations, unique files, declared file references, individual file
bytes, total unique input bytes and JSON nodes/depth. Hosts may supply reviewed
finite nonnegative limits; the defaults are preparation limits, not browser or
device-performance claims. The explicit byte-map API bounds verified snapshots;
host acquisition memory/streaming and owner decode reservations remain separate
responsibilities. An indivisible owner call must itself honor the supplied
limits; this synchronous facility does not forcibly interrupt arbitrary hooks.

Pre-cancellation and cancellation between bounded jobs throw `cancelled`; no
partial candidate is returned. As synchronous work it does not yield to a later
event-loop callback while running. Host acquisition abort/finally cleanup must
finish separately. Missing bytes, digest/identity drift, media mismatches,
references, collisions, limits and missing owners have typed error codes and
paths; errors thrown by an injected owner retain that owner's error details.

Output uses sorted object keys, explicit array order, two-space JSON and a final
LF, with exact manifest SHA-256/length and provenance. Shared resident byte
snapshots are charged once per unique URL; declared file references can be more
than unique files, including owner equivalence checks. This is no runtime cache,
render or media-download authority.

## Verification, delivery and rollback

Prepared owner fixtures cover a two-child aggregate, separate manifest/media
origins, local and cross-child links, explicit aliases, one shared sheet, unknown
heights/pose/credits/style, deterministic bytes and unmodified inputs. Negative
fixtures cover missing/corrupt/drifted pins, undeclared files, unsupported
representations/targets, incomplete/repeated order, invalid sheet cells and
opaque extensions, URL rebasing, collisions, small budgets and cancellation.
The updated isolated archive consumer loads both actual public exports under
existing runtime/declaration/closure/negative guards. It uses public leaf
contracts and explicit fixture data; no producer implementation is copied.

The historical unexecuted request remains at
`build/source-only/scene-composition-20261010/verification-request.json`.
The combined qualification uses fresh sealed source/dependency/request snapshots
and final archive/compiled/export/full-ref/actual installed receipts under
`build/repository-split/checks/2026-10-10-preview-scenes-qualified-delivery`.
Campus adoption, application/browser/bootstrap and actual remote admission
remain separate gates.
The existing same pinned `foss-earth/ci` caller/policy/19 conformance cases and
all publication branches/tags remain required, including docs-only changes.

Rollback retains the checked d58408d Scenes artifact, original content/media,
legacy routes and archived originals. Composition is additive and cannot alter
source manifests/media. Publish a distinct immutable aggregate path only after
qualification; consumers can continue selecting the old exact artifact and old
v1 document. No remote publication, Pages change, source commit or deployment
is included in this source preparation.
