# Shared operator chat network composition

Status: renderer-only, explicit-lifecycle adoption seam between the audited collaboration network
client and shared operator chat panel.

## Authority and lifecycle

The host creates an already-configured `CollaborationNetworkClient`, including its opaque bearer
evidence and fresh device-proof callback, then injects it with one `SharedProjectId` into
`createSharedOperatorChatNetworkComposition`. The composition never reads, stores, derives, or
persists credentials, device private keys, user identity, role, or membership authority.

Creation and React mounting are inert. Only the host may call `connect()` or `disconnect()`.
`refreshState()` reads the injected client's current state without I/O, while `subscribe()` and
`getSnapshot()` provide a synchronous renderer snapshot for `useSyncExternalStore`. There is no
automatic reconnect, polling, timer, delayed nudge, background retry, replay subscription, or
listener launch in this slice. Connect is single-flight and reentrancy-safe. Disconnect invalidates
every pending command generation and cursor before invoking the injected client, so a late client
completion cannot repopulate a cursor or acknowledge a send. A send that the panel marks retryable
retains its exact command ID, message ID, body, kind, context policy, and occurrence time.

The injected client and request wrappers must be plain own-data objects. Their callable
capabilities are captured once; accessor-backed, proxy-hostile, or otherwise malformed boundaries
fail with fixed protocol copy. Contract responses are bounded and cloned from inspected data
descriptors before schema decoding, so schema validation never rereads an admitted proxy and raw
adapter exceptions do not enter presentation state.

## Opaque cursor bridge

The transport deliberately exposes a server-authenticated opaque cursor; the panel deliberately
tracks an operator-readable numeric project sequence. The composition binds those representations
without parsing or manufacturing transport cursors:

1. Numeric sequence `0` maps to the transport's initial `null` cursor.
2. A page is strictly decoded and checked against the configured project, requested limit, unique
   message IDs and increasing sequences, requested authored kinds, complete message-order identity,
   and index-aligned exact lane positions.
3. Every admitted message must be after the requested numeric sequence. The next numeric checkpoint
   is the maximum admitted project sequence, and only then is it associated with the returned opaque
   cursor.
4. An unknown or expired numeric checkpoint fails locally; it never falls back to `null` or skips
   history. The adapter retains at most 64 checkpoints.

Empty terminal pages preserve the requested numeric sequence. An empty page claiming more results
fails closed, preventing an explicit caller from being trapped on a non-advancing hostile cursor.
Pages also remain inside the transport response-byte ceiling, even when a test or alternate injected
client bypasses the production network client's decoder. After replacing the opaque cursor with the
numeric checkpoint, the result is decoded again against the stricter authored-page byte contract.
An omitted page limit retains the authored-message contract default of 100 rather than expanding to
the 256-message maximum.

## Append correlation and failures

The adapter removes only the local `AbortSignal` wrapper and forwards the canonical append request
unchanged. A success is admitted only when the decoded message belongs to the configured project and
matches the requested message ID, kind, body, context-inclusion policy, and occurrence time. A server
`conflict` becomes the panel's bounded conflict result; the adapter does not claim `already-accepted`
because the current network response contains no such disposition. All unknown exceptions are
reduced to a stable safe failure without response bodies, paths, credentials, or exception text.

This seam does not add chat transport authority, file synchronization, database coordination,
private messaging, agent dispatch, or provider execution. Each remains a separately reviewed
capability.
