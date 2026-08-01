# Collaboration chat/context network adapter

This slice binds the project-scoped collaboration transport facade to a dedicated HTTP and WebSocket listener. It carries authored shared-chat messages and compact context packets only. It is disabled by default and is not connected to the desktop launcher, the existing server RPC surface, file bytes, database materialization, task execution, or agent orchestration.

## Deployment boundary

- The adapter binds `127.0.0.1` unless a host is explicitly configured. A non-loopback bind additionally requires an explicit opt-in, TLS key/certificate material, and HTTPS-only allowed origins.
- `allowedHosts` and `allowedOrigins` are mandatory exact allowlists. Requests with an unexpected Host or Origin, any query string, a missing bearer header, or an invalid route receive a generic response. Session credentials are accepted only through the `Authorization` header and are never accepted from URLs.
- The listener is injectable for deployment and tests. Production enablement must supply a production principal resolver, device-key authority, TLS material for every non-loopback deployment, an explicit address/port, and narrow allowlists. Merely importing this module opens no port.
- HTTP exposes unary facade operations at `/api/collaboration/v1/command`. WebSocket exposes the same operations plus finite replay at `/api/collaboration/v1/socket`. No existing server-wide RPC method is reachable through this adapter.

## Authentication and authorization

The network boundary creates only opaque authentication evidence: the bearer session token, a device proof, exact origin, transport kind, and SHA-256 hash of the operation body. It cannot create or accept a user, device, project, role, or membership principal.

The server-owned `CollaborationTransportPrincipalResolver` must validate the session and the device signature over the deployment's canonical request binding, including the intended session, device/key, operation and target project, request-body hash, timestamp, and nonce. The transport facade then enforces current project membership, membership epoch, operation permission, and active device key before work and before releasing results. Replay revalidates authority for every batch. Revocation therefore ends a replay instead of allowing a stale authenticated stream to continue.

Resolver, project, membership, device, and hidden-record failures remain the facade's non-enumerating public `not-found` result. The adapter never trusts a principal supplied by a frame.

## Resource and abuse limits

- Request and response frames, listener connections, per-connection in-flight requests, replay subscriptions, replay rate, general request rate, remembered nonces, queued messages, and queued bytes all have finite limits.
- Source-address and credential rates are keyed separately with an in-memory HMAC secret. Rotating fake bearer strings does not bypass the source limit, and diagnostics cannot expose the original keys.
- A timestamped device nonce is accepted once within a bounded lifetime. The principal resolver still verifies the signature; nonce admission alone is not authentication.
- WebSocket compression is disabled. Binary frames are rejected. Replay delivery uses a nonblocking bounded offer; a full or oversized outbound queue reports `slow-consumer` and closes the peer rather than blocking project admission.
- Each WebSocket request has an abort controller. Cancel frames, disconnects, and server shutdown propagate cancellation. Ping/pong heartbeat terminates peers that cease proving liveness.
- Shutdown stops new admission, aborts active facade work, requests WebSocket closure, drains for a bounded grace period, and force-closes remaining peers.

## Error and logging policy

Wire errors contain only protocol version, request ID when one was safely decoded, and a bounded public error code. Unexpected internal failures become `unavailable`; they do not serialize exceptions, stack traces, SQL details, credentials, project identifiers, message text, or paths.

The optional diagnostic callback is metadata-only by type. It can report listener/connection state, transport kind, and public outcome code. It cannot receive authentication headers, query strings, request bodies, prompts, project/user/device identifiers, or credential-derived rate keys.

## Deliberate limitations

Replay is finite and cursor-based; this slice does not add a durable live-tail broker. A client may poll or reconnect from its last opaque cursor. Cross-network file synchronization, conflict-safe database collaboration, user interface, invitation/onboarding, key custody, and orchestration remain separate reviewed slices. They must not be added by widening this listener into a generic RPC endpoint.
