# Streaming text delivery repair

Date: 2026-10-22.

Club Code could omit text fragments while sending an assistant response to a
slow renderer. The provider output and stored message could remain correct
while the visible response joined parts of different words.

The subscription hub classified streaming `thread.message-sent` events as
replaceable updates. These events contain append fragments, not complete
message snapshots. While a subscriber waited for its next pull, a newer
fragment replaced an older fragment for the same message. Claude often ends
these messages with an empty completion event, so the renderer had no final
text replacement to correct the displayed response.

Read-only comparison of the affected Fable session found ten recent text
blocks identical in the native Claude transcript, mapped provider deltas,
and stored messages. The reported corrupted words were absent from those
assistant records. A deterministic slow-subscriber test reproduced the faulty
policy: five queued fragments became one.

Streaming fragments are now protected events. The hub preserves every fragment,
including whitespace, in sequence. Full session snapshots can still replace
older pending snapshots between protected events. Existing queue byte and event
limits remain active. An overloaded subscriber must reconnect and load a fresh
snapshot instead of receiving incomplete text. This policy applies to all providers.

Regression coverage checks exact streamed text after a delayed pull, session
snapshot replacement around protected barriers, and overload recovery for both
streaming fragments and complete messages. No transcript text, credentials,
or provider permissions were added to diagnostics or changed by this repair.

## Validation on the live checkout and activation

Formatting, lint, typechecking, all nine test workspaces, and the desktop build
passed. The server suite passed 2,228 tests with one intentional skip across
224 files. The subscription hub suite passed eight tests. Three focused renderer
suites passed 45 tests. The new slow-subscriber test failed before the fix and
passed afterward.

The fix was activated at 2026-10-22T20:32:43.1746657Z. Only the backend restarted,
from PID 38576 to PID 10216. The original provider daemon and all three
observed provider CLI processes kept their PIDs and creation times. The restarted
backend returned HTTP 200. Reconnecting renderers receive a fresh thread snapshot
from the intact stored messages. No stored message rewrite was needed.

Server bundle SHA-256: `8445053a9fdc0fc944a0a03514f96ea212b8bfdf27a696f424acc81c8289509a`.

The live checkout also contains separate pending changes. The published fix is
limited to the outbound policy, subscription hub regression tests, this report,
and the matching architecture guidance. Validation on the isolated publication
branch is recorded in the pull request. No remote CI or other-platform result
is claimed here.
