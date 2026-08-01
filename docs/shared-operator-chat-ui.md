# Shared operator chat UI adoption seam

Status: web-only, injected, default-unreachable adoption slice based on the audited shared authored
message and pointer-only context packet contracts. This slice opens no socket, endpoint, fetch, RPC,
provider, agent, filesystem, launcher, or desktop bridge. `SharedOperatorChatPanel` renders nothing
unless an adopting caller supplies a `SharedOperatorChatClient`.

## Visible data boundary

The lane displays only the two project-visible, operator-authored contract kinds:
`operator-chat` and `authored-prompt`. Each row identifies its project member, authored kind, UTC
instant formatted for the viewer, and authoritative project sequence. Tombstoned bodies are replaced
with a fixed removal notice.

The component has no contract or prop for provider output, private messages, private thread history,
reconstructed private prompts, credentials, host paths, model names, system prompts, or agent
execution. React renders authored bodies as text, never markup. Context packets are summarized only
from integrity pointers: packet/message IDs, author ID, kind, sequence, body hash, byte/token counts,
and exclusions. The UI never copies source bodies into a packet summary.

## Bounded history and roster

Reads request 100 messages and cannot exceed the audited contract's 256-message page maximum. Page
application is single-flight, project-scoped, cursor-monotonic, and rejects malformed order lists,
duplicate sequences, skipped cursors, changed immutable message hashes, stale responses, and
cross-project payloads. The virtualized lane retains at most 2,048 rows. If a project is larger, the
operator can continue paging toward the newest bounded window while old rendered rows are released.

The audited project member maximum is 128 unique users. Invalid or oversized rosters fail closed
before a read. The header previews at most 20 display names and reports the complete count. Context
packet summaries show at most 8 packets and 20 pointers per expanded packet.

## Idempotent delivery and lifecycle

Each send receives one client request ID and one message ID before its first attempt. Pending,
accepted, conflict, retry, and retrying states are explicit. Manual retry and automatic reconnect
reuse the exact request and IDs; neither path manufactures a replacement message. A successful
append acknowledgement is deduplicated by message ID but does not advance the contiguous page
cursor, so it cannot skip concurrent operator messages.

At most 20 unresolved sends are retained. Offline or reconnecting state queues them without calling
the client. Connection loss aborts active attempts and makes them retryable. Project/client changes
and unmount abort page and send requests, clear project-local UI, and invalidate late results.
StrictMode's discarded setup is filtered before admission. Raw thrown errors are not displayed;
only bounded safe state/codes remain in memory.

## Deferred authenticated adoption

A later PR may mount this panel only after supplying a separately reviewed client that:

- authenticates the current operator and resolves current project membership server-side;
- decodes the existing collaboration contracts before returning data;
- honors every `AbortSignal` and preserves idempotent command receipts across reconnects;
- binds visibility-aware replay or live subscriptions without duplicating page/send results; and
- keeps private messaging, providers, agents, and shared-file execution in separate authority lanes.

This component is presentation and lifecycle policy only. It does not make cross-network coworking
live by itself.
