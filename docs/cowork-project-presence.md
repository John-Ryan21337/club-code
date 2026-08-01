# Cowork project presence authority

`CollaborationPresenceAuthority` is the server-owned, ephemeral availability
slice for operator-to-operator coworking. It deliberately is not a listener,
RPC method, UI feature, file-sync component, task runner, provider bridge, or
activity history.

## Boundary

An authenticated transport supplies a server-resolved collaboration principal
and enrolled device-key ID; it must never take either from a command body. The
authority checks current project membership plus the active device key when a
session is opened, on every heartbeat/read/subscription, and through
`recheckProject` when membership or device revocation is committed. A failed
recheck removes the session and publishes a removal delta before returning the
generic, non-enumerating `not-found` result.

Presence session IDs are random 32-byte opaque capabilities. They are not user,
device, project, database, or transport session IDs. A device can hold at most
four presence sessions. Reconnects may safely supersede a same-device session;
the project-wide limit is 128 sessions so snapshots can represent every active
entry. Opening with the same request ID is idempotent, as are heartbeat receipts
and accepted close receipts. Each receipt is bound to the complete decoded
operation; reusing an ID for different state, capabilities, or a different
session fails with `conflict`.

## Privacy and retention

The roster can contain only user ID, device ID, membership epoch, opaque
session ID, server expiry, `online`/`away`/`offline`, and two coarse
capabilities: `operator-chat` and `shared-context`. The contract cannot carry
paths, prompts, provider/model details, task/activity state, or model output.

The authority keeps only active sessions, a bounded in-memory delta replay ring
(128), bounded operation receipts, and live subscriber handles. It has no
database schema and writes no detailed activity history. Its optional audit sink
gets project-isolated HMAC pseudonyms and operation outcome only.

## Binding a transport

The later HTTP/WebSocket binding owns authentication, origin/TLS policy,
network queues, cancellation, and shutdown. It calls `open`, `heartbeat`,
`close`, `snapshot`, or `subscribe` with the resolver-issued identity. Subscriber
`offer` is synchronous and non-blocking: a full outbound queue returns `false`,
causing the authority to drop that subscriber rather than holding a project
operation or buffering unbounded output.

Each subscription is bound to the presence session that created it and is
detached before that session expires, closes, or is purged after revocation.
Consumers receive defensive update copies; callback throws or backpressure drop
the subscriber without mutating retained project state.

Subscribers request a monotonically versioned snapshot/delta stream. If the
requested version is not retained, the first update is an authoritative
snapshot; otherwise retained deltas replay in version order. The normal roster
is 20 entries and protocol requests are capped at 128.

The binding should call `sweepExpired` on a server-owned timer and always call
the returned subscription's `unsubscribe` during connection shutdown. Neither
operation starts a timer or network listener itself.
