# Declared external scene navigation

Prepared 2026-10-10. Qualification receipts, exact archive pins and limitations
belong to the Earth handoff. The CPU fixtures do not qualify a browser or device.

Local links retain the existing required `target` panorama ID. A standalone v1
scene may also declare `externalDestinations`:

```json
{
  "externalDestinations": [
    { "id": "east-tour", "sceneId": "east-scene", "routeId": "east" }
  ]
}
```

An external link retains its authored ID, label, direction, arrival view and
position in the entity's `links` array. It adds `externalDestination: "east-tour"`;
its `target` is the named panorama in that declared external scene. The scene
and optional route are stable v1 IDs, never addresses. Validation rejects unknown
declarations, duplicate IDs, invalid scene/route IDs and dangling local targets.
Scenes neither fetches the destination nor guesses a URL parameter.

Supply `LoadSceneOptions.externalNavigation` through the public browser entry:

```ts
import type { SceneExternalNavigationPorts } from "@foss-earth/scenes/browser";

const navigation: SceneExternalNavigationPorts = {
  async navigate({ destination, sphereId, source, link, signal }) {
    // Host checks its declared route registry, selects the named scene, places
    // the panorama and applies link.arrivalView. Its own transport is bounded.
    return host.selectScene({ sceneId: destination.sceneId,
      routeId: destination.routeId, sphereId, source,
      view: link.arrivalView, signal });
  },
};
```

The public handle, viewer actions and projected hotspots use this same port.
Without it, external links remain in metadata with `enabled: false`; local
navigation continues working. Hosts own route selection, acquisition, external
history and scene handover. They return an honest `SceneActionResult` and honor
cancellation. Scene disposal or generation retirement aborts the supplied
signal. `whenSettled()` still waits for the real host promise to finish; abort or
termination alone does not prove retirement. Resolve the accepted operation
before disposing its source, or treat a disposal during handover as cancellation.

The optional validated destination map keeps structural legacy hosts compatible.
The loader always supplies it. A scene without these additive fields remains
valid. Older artifacts cannot load external declarations; retain the previous
archive and local-only documents for rollback. Composed crossing links use the
ordinary local target after explicit consumption, so their navigation continues
to work with local-only hosts.
