# Collaboration authored messages and compact context

Status: bounded server/contracts slice. This is not a network transport, UI, file-sync engine,
agent dispatcher, or private-message system.

## Stack dependency

This slice uses migration **074** and must be applied after the collaboration device
identity/key lifecycle PR, which owns migration **073**. It builds on the cowork foundation,
database coordination, membership/invitation, and device-authority layers. A downstream PR
should therefore use the published device PR head as its base rather than cherry-picking this
migration directly onto the membership PR.

## Authored data boundary

Only two shared, human-authored kinds are accepted:

- `operator-chat`: operator-to-operator project chat.
- `authored-prompt`: a prompt explicitly submitted by an operator to the shared transcript.

There is no kind for private messages, hidden/system prompts, provider output, agent output,
raw filesystem paths, or secret material. Those inputs cannot be normalized into this store.
Every write is attributed to the currently authorized project user and device. The store does
not trust identity, role, permission, membership epoch, sequence, or receive time from message
content.

Messages are immutable and append-only. Each project has a monotonic merged sequence and SHA-256
chain; each operator also has a monotonic lane sequence for side-by-side presentation. Retrying a
command is exact and is bound to its authenticated user, device, and membership epoch. A removal
request writes recoverable tombstone metadata to a separate table and never deletes or rewrites the
source message.

## Compact context packets

A packet stores only integrity-checked pointers to explicitly selected shared messages, plus token
and encoded-byte budgets. It never duplicates message bodies. Callers must declare the source kinds,
and the store checks the corresponding current read permission before selecting any row.

Messages marked `excluded-sensitive`, tombstoned messages, and messages already covered by a base
packet are recorded as exclusions. A delta packet rechecks the base packet's sources so a message
tombstoned after the base packet was created is explicitly revoked and cannot silently re-enter via
base reuse. Consumers must apply the newest packet's exclusion list to the entire resolved base
chain before attaching context. Exact replay of an older packet command also fails once one of its
sources is tombstoned; idempotency cannot be used to resurrect a revoked source.

Read pages, source counts, message characters/UTF-8 bytes, context budgets, and packet source counts
are all bounded. Token admission uses UTF-8 byte length as a conservative upper bound instead of an
optimistic bytes-per-token heuristic. SQLite writer reservations serialize concurrent project
appends across processes, page reads recheck current membership before returning, and stored body,
input-receipt, message-chain, tombstone, and packet hashes fail closed on corruption.

## Deferred integration

Network endpoints, subscriptions, UI lanes, remote file synchronization, agent dispatch, context
materialization, and device signing are intentionally outside this slice. A future endpoint must
authenticate the device session first, decode these contracts at the transport boundary, keep
authorization failures non-enumerating, and resolve pointer-only packets without logging or
persisting reconstructed prompt content.
