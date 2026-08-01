# Collaboration network client boundary

`@cafecode/client-runtime` exports a bounded client for the version 1 collaboration chat and
context transport. Creating a client performs no I/O and leaves it disconnected. A caller must
inject the HTTP requester and authenticated WebSocket factory, then call `connect()` explicitly.
The client never reconnects or retries on a timer.

The only destinations it derives are:

- `POST /api/collaboration/v1/command` for append, tombstone, page, and context-packet commands.
- `/api/collaboration/v1/socket` for bounded replay subscriptions and exact cancellation frames.

Configuration accepts an exact server origin, an exact client Origin value, opaque session
evidence, a request-ID source, and a fresh device-proof function. It has no principal, user, role,
membership, or project authorization claims. The server remains the authority that resolves those
claims. Session evidence is sent only as a bearer header; URL credentials, paths in origins,
queries, fragments, and insecure non-loopback origins are rejected.

Both directions use the shared strict schemas and byte limits. The client also caps in-flight work,
replay subscriptions, queued messages, and queued bytes at the contract limits. Caller cancellation
aborts HTTP work or emits one matching WebSocket cancel frame. A malformed, oversized, binary, or
uncorrelated server response fails closed with a stable public error and disconnects the socket when
appropriate. Transport exceptions, URLs, credentials, response bodies, and local paths are not
included in public errors.

This package deliberately does not compose a listener, tunnel, launcher, filesystem sync, task
transport, database replication, provider execution, or agent orchestration. Those capabilities
require separate authority and threat-modelled boundaries.
