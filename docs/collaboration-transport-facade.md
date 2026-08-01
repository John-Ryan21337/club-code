# Collaboration transport facade

This slice adds a listener-independent server boundary for the shared authored-message and compact-context authorities published in the preceding collaboration PRs. It is intentionally not a network server.

## Security boundary

- A caller supplies opaque authentication evidence, never a principal. A server-owned resolver must validate the authenticated session and device signature before returning a principal and current device-key ID.
- Every operation checks current project membership, permission, membership epoch, and active device key before it reaches the store. Authority is checked again before a response is released; replay checks it for every batch.
- Project mismatch, forbidden membership, revoked devices, resolver failures, and hidden store records all map to the same public `not-found` code. The facade does not expose a project-enumeration oracle.
- Page and replay cursors are AES-256-GCM envelopes bound to one project. They do not expose or accept raw database sequence positions.
- Request frames, response frames, project concurrency, replay batches, and replay messages are bounded. Overload rejects immediately instead of creating an unbounded wait queue. A replay binding must reject an offer when its bounded outbound queue is full; the facade then terminates the slow consumer.
- `AbortSignal` cancellation interrupts authority checks, store work, and replay delivery, and admission is released in all cases.
- Audit events contain only operation, outcome, byte counts, and server-keyed one-way project/actor references. Their type cannot contain authentication material, prompts, message bodies, context contents, token values, or paths.
- The cursor secret must contain at least 32 random bytes and remain in server-owned configuration.

## Deliberate exclusions

This facade slice itself does not add an HTTP, RPC, WebSocket, or public network listener. It does not add UI, OS key custody, file synchronization, database migrations, agent dispatch, or server-wide orchestration methods. The subsequent [collaboration network adapter](./collaboration-network-adapter.md) binds only these project-scoped methods on a separate default-off listener; it does not translate the facade into a general server orchestration RPC surface.
