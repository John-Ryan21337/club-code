# Current-device cowork key status

`CoworkCurrentDeviceKeyModel` and `CoworkCurrentDeviceKeyPanel` are an adoption-ready, web-only
presentation boundary over PR #45's authenticated current-device authority. They have no production
wiring. A null client renders nothing and performs no work. An injected client exposes only one
current-status read and one self-revoke command; this slice creates no endpoint, transport,
subscription, timer, poller, storage entry, OS key-custody bridge, provider request, process, agent
task, or device enumeration.

The one automatic status read sends only `sharedProjectId`. The server derives user and device
identity. The panel admits only an exact project, user, device, and membership-epoch match against
the caller's authenticated scope, and then presents either the current active key's public ID and
activation time or `enrollment-required`. Excess, incomplete, accessor-backed, proxy-wrapped,
cross-scope, stale-epoch, or otherwise malformed responses are concealed as unavailable. No key
bytes, challenge, proof, nonce, digest, receipt, or another device can enter presentation state.
Plain-data inspection also bounds scalar strings before cloning, and invalid replacement clients
or scopes fail closed to fixed copy without leaving the prior key presentation committed.

Self-revocation requires a separate destructive confirmation after an active status was admitted.
Confirmation freezes one request containing only a new command ID, the same project, and the exact
admitted current key ID. A validated `revoked` or exact `already-applied` response must remain bound
to the same project, user, device, membership epoch, key ID, and activation time and must carry a
revocation time. An indeterminate acknowledgement retains that exact frozen request; retry reuses
the same object and never creates a replacement command. Project, user, device, membership-epoch,
or injected-client replacement synchronously removes old key, confirmation, pending, and retry
presentation, stops the old model, and ignores its late result.
Command-ID construction is reentrancy-guarded, while snapshot-isolated observers cannot expand an
active notification pass or convert an authority result into a transport outcome.

This child deliberately does not compose with PR #43's separate enrollment signer UI. A future
production surface must inject an authenticated transport adapter and authoritative current scope;
it must not add client-selected identity, device lists, background refresh, or browser key custody
to this boundary.

The authenticated network composition is documented in
`docs/cowork-current-device-network-composition.md`. Its explicit web adapter exposes only current
status and self-revoke, and preserves the exact revoke request for an operator-triggered retry.
