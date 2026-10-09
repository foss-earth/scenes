# Scene navigation lifecycle

Scenes owns envelope navigation outcomes. The supplied viewer owns the camera
lease, exit animation, input and shared renderer frames.

`showOverview()` returns `busy` while a panorama is held. It does not call
`viewer.exit()` or request terrain as a side effect. Cancelled pending overview
preparation becomes `none`, including an externally aborted request whose world
port returns late success. An older request cannot erase a later applied overview.
An already applied usable overview remains applied when a later request is cancelled.

`exit()` invokes the viewer once and awaits its existing status subscription until
the phase is `overview` with no active or target image. Repeated requests join that
transition and publish history once. A cancelled preparation can finish through
the same status port. No timer, animation frame, polling loop or navigation owner
is created by Scenes.

Replacement/disposal aborts the outgoing scene scope, settles its pending exit as
cancelled and releases the observer. New incoming viewer navigation cancels the
outgoing transition's wait. Native exit or observer cleanup failures are reported
as failed outcomes; an early overview notification cannot conceal a later native
throw. History is recorded only after actual successful settlement in the current
scene generation.

The causal cases are in `tests/sceneHandle.test.ts`. Original facade assertion
sources under `fixtures/composition/` and `docs/legacy-lifecycle-assertions.json`
remain unchanged. These additions are SOURCE ONLY until primary qualification.
