The `@foss-earth/scenes/node` entry exports `checkSceneFiles`, `checkSceneManifest`, `validateSceneDocument`, `localSceneReader` and `builtInSceneHooks`. `validateSceneDocument` checks the manifest text and does not read media files. The `foss-earth-check-scene MANIFEST --base-url URL --json FILE` CLI retains the existing publication report, JSON fields and exit status. It uses compiled public owners and starts no server or network request.

`checkSceneFiles(scene, read)` retains the existing two-argument API. Its optional third argument supplies representation hooks for a custom catalogue. The file reader is injected. Common image headers come from images; the built-in catalogue and preview requirement come from 360; face fields come from cubemap; whole-image fields come from equirectangular; tile addresses and level groups come from tiled-cubemap. Preview-sheet validation and pixel comparison come from preview-sheets. The envelope owns only traversal, counts and diagnostic assembly.

The reader rejects decoded traversal and symlinks outside the manifest folder. A missing file suppresses that representation's aggregate-byte diagnostics. A shared URL counts separately for each declared use. Face diagnostic fields use the enumeration ordinal, so six equal URLs still produce six correct authored fields. Existing sheet and whole-image diagnostics are preserved.

`fixtures/composition/SceneFileTests.ts` registers the six original application example assertions using a host-supplied examples URL and public validation/file-check functions. The application owns its example photographs and manifests. The fixture does not distribute Campus implementations or photos in this shared package.

This is unchecked source preparation. Original CLI behavior fixtures, isolated packed Node/declaration consumers, full owner checks, source lineage, installed shared attribution conformance and actual application adoption remain pending.
The pure root also exports `checkSceneFiles(scene, read, options)`. Its explicit
representation file/group hooks and opaque extension file hooks keep layout
knowledge with the owners. It imports no Node, DOM or GPU tools. The optional
Node entry binds the built-in owners and retains the original two-argument
checker and CLI. Neither draft has qualified a replacement artifact yet.

New source fixtures preserve repeated-URL face fields, whole/tile totals,
missing-file suppression and optional sheet diagnostics. Preview document
mutation belongs to `./preview-sheets` and its build CLI. It protects local
originals and rejects escaping manifest/media symlinks before mutating files.
Filesystem race/atomic publication qualification remains pending. See
`installed-consumer.md` for the queued exact archive closure and both Node/bin
consumer contracts.
