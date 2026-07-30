# Secure Coworking Architecture

Status: proposed implementation contract  
Target: Club Code / Cafe Code shared projects  
Protocol participant ceiling: 128  
Initial supported limits: 20 participants, 20 active editors, 8 concurrent agent runners

## Product contract

A shared project gives invited operators a common, authored project timeline,
operator chat, task coordination, agent handoffs, and synchronized project files.
Every operator retains control of their own machine, credentials, agents, and
local recovery history.

The collaboration system must preserve these invariants:

1. A remote participant cannot address or discover paths outside the locally
   selected shared-project replica.
2. A remote participant cannot irreversibly delete another operator's local
   file. A shared delete is a tombstone; each receiver archives the last local
   version or may retain it according to local policy.
3. Shared agents never receive `danger-full-access`. They run in a dedicated
   OS-level sandbox with only the managed replica mounted.
4. Project authorization is checked for every command, subscription, snapshot,
   event, and blob. Authentication to a Cafe server is not project
   authorization.
5. Prompts, chat, task messages, and file changes are attributed to a user and
   device in an append-only audit history.
6. Provider credentials, home directories, system prompts, local-only
   messages, absolute paths, and unrelated provider events are never
   replicated.
7. Agent context is assembled deliberately and incrementally. Joining a project
   does not feed its complete transcript or operator chat to every agent.

## Boundary decision

The existing remote environment connection is a control connection to one Cafe
server. It currently authenticates a session but does not supply project
membership authorization to every orchestration handler. Raw orchestration
events also contain server-local identities, provider state, and workspace
paths.

Coworking therefore uses a separate, project-scoped collaboration plane. It
does not expose the existing server RPC surface to peers and does not replicate
the raw orchestration event log. Authorized collaboration events may be bridged
into a local thread or workflow only after validation and attribution.

Clients make outbound TLS 1.3 connections to a collaboration coordinator or
relay. Enabling coworking does not open a local firewall port or create an
automatic public tunnel.

## Identity and authorization

Each project, person, installation, and agent has a distinct stable identity:

- `SharedProjectId`
- `UserId`
- `DeviceId`, backed by a durable device signing key
- `CollaborationAgentId`, scoped to a shared project and local runner

Project roles are `owner`, `admin`, `operator`, `contributor`, and `viewer`.
Agent/service identities are explicit and never inherit a human's complete
authority. Permissions are granular:

- manage members and invites
- read or append project transcript
- send operator chat
- dispatch a shared prompt
- create, claim, or complete a task
- launch or message an agent lane
- publish a file version
- apply a remote version locally
- approve a sensitive operation
- export the audit history

The authenticated principal passed to collaboration handlers includes the
user, session, device, project membership, and membership epoch. A membership
change increments the epoch. Revoked devices cannot resume a stream, redeem a
stale cursor, upload a blob, or replay a signed command under an old epoch.

Sessions use short-lived, project-scoped access and WebSocket tokens with
rotating refresh credentials. Invites are single-use and expire. Desktop
secrets use the existing operating-system-backed safe-storage pattern.

The first release may use TLS to a trusted coordinator, with that trust model
shown clearly in the UI. End-to-end group encryption must use a reviewed
protocol such as MLS; bespoke cryptography is prohibited. Membership changes
rotate group keys when end-to-end encryption is introduced.

## Collaboration event model

`collaboration_events` is a new append-only store, independent of local
orchestration events. Every event contains:

- shared project ID and server sequence
- client event ID and idempotency key
- actor user, device, and optional agent
- membership epoch
- event type and bounded payload
- causation and correlation IDs
- referenced content hashes
- occurred-at and received-at timestamps
- device signature

Commands use expected revisions or base content hashes. Reconnect retries the
same idempotency key. Each device ACKs a cursor and resumes through a bounded
snapshot followed by monotonic deltas. Offline devices queue signed commands,
refresh membership before upload, transfer only missing blobs, and retain
conflicts rather than overwriting.

Compaction emits a signed project snapshot and manifest checkpoint. It cannot
erase the authoritative audit trail inside its retention policy or require a
returning device to replay an unbounded stream.

## Transcript and operator chat

The project transcript is an append-only, authored causal timeline. The UI
offers both a merged view and side-by-side lanes filtered by operator. A shared
operator prompt records:

- author
- target thread or task lane
- project visibility
- command ID
- event sequence

Operator-to-operator chat is a separate channel. It is available to people in
the project but is not automatically agent context. An operator can explicitly
attach a chat message or range to a task or prompt.

Local-only prompts, system messages, provider secrets, approval credentials,
and hidden runtime messages never enter the shared transcript.

## Agent coordination and token efficiency

Agents coordinate through a durable typed task graph:

- create, claim, lease, renew, block, complete, and release
- one owner per active lane
- explicit dependencies and artifact hashes
- bounded agent-to-agent messages
- idempotent state transitions

The initial limit is eight concurrent project agent runners. An agent runs on
one operator's machine in an isolated lane and publishes proposed artifacts;
it does not remotely drive another operator's provider process.

Agents receive a versioned compact context packet rather than the whole project
history. A packet includes:

- the active operator request verbatim
- unresolved-request ledger
- accepted decisions
- owned task, dependencies, and lane owner
- relevant file and artifact hashes
- bounded event deltas since the agent's cursor
- provenance pointers to source events
- packet revision, hash, and token budget

If an agent already holds the base packet, only the delta is sent. Derived
summaries are cacheable navigation aids and never replace the authored audit
transcript. Operator chat is excluded unless attached explicitly.

## File synchronization

Peers exchange project-relative path identifiers, immutable content-addressed
blobs, and signed manifest events. They never exchange a host absolute path or
invoke a generic remote `writeFile` or `deleteFile` API.

Each device maps a shared project to a dedicated managed replica root selected
locally. An incoming file version contains:

- normalized relative path
- base manifest revision and base content hash
- new content hash, byte size, and media classification
- author, device signature, and idempotency key

The receiver downloads into staging, enforces quotas, verifies the hash and
declared size, validates every path component, rechecks the root identity, and
then materializes atomically with no-follow/handle-relative filesystem
operations.

The materializer rejects:

- absolute, UNC, device, drive-relative, parent, and NUL-containing paths
- Windows alternate data streams and reserved names
- Unicode normalization and case-fold collisions
- symlinks, junctions, reparse points, and hardlink escapes
- root or mount identity changes and time-of-check/time-of-use swaps
- archive traversal, decompression bombs, oversized blobs, and unsafe modes

Text edits require a base content hash. Clean three-way merges may be applied
automatically; all other cases create conflict versions and preserve both
sides. Binary files are immutable versions and never auto-merge.

Agent edits use per-lane worktrees or branches and enter a merge queue. A later
phase may add a vetted CRDT such as Yjs or Automerge for keystroke-level text
collaboration. The project will not implement a custom CRDT.

### No-remote-delete guarantee

A remote delete is represented only as a manifest tombstone. On each receiver:

1. Confirm the path belongs to the current shared manifest and replica root.
2. Move the last materialized version into a local recovery/version store, or
   leave it visible when local policy forbids removal.
3. Remove the path from the shared view without recursively deleting it.
4. Retain author, time, prior hash, and tombstone provenance in the audit log.

Only the local owner may garbage-collect recovered versions, subject to a
retention window and explicit confirmation. A peer cannot target files that
were never part of the shared manifest.

## Shared-agent sandbox

Provider CLI sandbox flags alone are not the security boundary. Shared agents
run in a dedicated container, VM, or equivalent OS sandbox with:

- only the managed project replica mounted
- no user home, SSH directory, provider auth home, browser profile, clipboard,
  desktop IPC, arbitrary OS dialog, or host socket
- default-deny network egress through an allowlisted, auditable broker
- no automatic git hooks, setup scripts, package installs, or executable file
  launches
- resource, process, disk, network, and output quotas

Shared content is untrusted input and cannot override local system policy,
expand its sandbox, authorize an approval, or reveal a credential. Sensitive
operations require a local approval tied to the exact project, actor, task,
resource, and expiry.

## Capacity

The protocol and persistence schemas enforce a hard ceiling of 128 members so
raising supported capacity does not require an identity migration.

The initial supported limits are deliberately separate:

- 20 project members
- 20 concurrent active editors/presence publishers
- 8 concurrent agent runners

Presence and viewers are cheaper than file and agent fanout. The limits may be
raised only after load, partition, revocation, abuse, and backpressure testing.

## Delivery phases

### Current implementation evidence

- `packages/contracts/src/collaboration.ts` defines the protocol member ceiling,
  role/permission matrix, membership epochs, authenticated project principal,
  and append-only attributed event envelope.
- `apps/server/src/collaboration/CollaborationAuthorization.ts` is the first
  centralized server authorization boundary. It resolves authority only from
  the current server-owned membership, rejects cross-project access, stale
  epochs, invalid session lifetimes, removed members, and permissions absent
  from either the member grant or role ceiling.
- Focused contract and server tests cover principal serialization, the
  cross-project IDOR matrix, epoch revocation, membership removal, session
  validity, and permission narrowing.
- Device key enrollment/signature verification, durable membership and event
  stores, invites, coordinator transport, subscriptions, chat/transcript UI,
  sandboxed agent runners, and file materialization remain unimplemented. No
  current code from this phase exposes a network endpoint or mutates shared
  files.

### Phase 0: security foundation

- Project principals, role/permission matrix, and centralized authorizer
- Device identity, signed commands, membership epochs, and revocation
- Append-only event store, idempotency, snapshots, and audit viewer
- Outbound relay connection
- No file mutation or agent dispatch

### Phase 1: shared room

- Membership and expiring invites
- Presence
- Operator chat
- Read/append shared authored prompt transcript
- Merged and side-by-side operator lanes
- Explicit context attachment controls

### Phase 2: agent coordination

- Task graph, claims, leases, dependencies, and bounded messages
- Compact context packets and delta reuse
- One local sandboxed runner per claimed lane
- Bridge bounded task lifecycle into the existing workflow visualization

### Phase 3: safe file exchange

- Content-addressed blob and manifest service
- Dedicated managed replica and secure materializer
- Publish/apply preview
- Recovery-only tombstones
- Base-hash conflict versions and merge queue

### Phase 4: realtime text

- Reviewed CRDT integration
- Cursor and selection presence
- Local watcher integration and offline merge
- Versioned binary synchronization remains unchanged

### Phase 5: hardening and scale

- Group end-to-end encryption when the coordinator model requires it
- 20-user soak tests and 128-member/presence simulation
- Partition, revocation, relay-compromise, and abuse testing
- Evidence-based increases to active editor and agent limits

## Implementation surfaces

New shared contracts should live in:

- `packages/contracts/src/collaboration.ts`
- `packages/contracts/src/sharedProject.ts`
- `packages/contracts/src/fileSync.ts`
- branded IDs in `packages/contracts/src/baseSchemas.ts`
- project-scoped RPC schemas exported through the environment API

New server components should live under
`apps/server/src/collaboration/` and cover authorization, event and blob stores,
subscriptions, task leases, context packets, manifests, and the local bridge.
Persistence begins with new migrations; collaboration state is not added to the
raw orchestration event table.

The WebSocket entry point must pass the complete principal into collaboration
handlers. A separate `/collaboration/ws` endpoint is preferred because it makes
the capability boundary and load isolation explicit.

The web application adds project collaboration state and components for
members, presence, project chat, transcript lanes, tasks, sync conflicts, and
audit. The desktop application owns device secrets, replica-root selection,
the sandboxed runner, and the egress/credential broker.

## Required gates

- Contract round trips, hard-cap validation, and migration replay
- Complete project-ID authorization/IDOR matrices for every RPC and subscription
- Revocation during an active stream and stale membership-epoch replay
- Duplicate, out-of-order, offline, reconnect, snapshot, and backpressure tests
- Cross-platform path property/fuzz tests, including symlink, junction,
  reparse-point, hardlink, archive, case-fold, and TOCTOU attacks
- Proof that remote tombstones cannot physically delete or escape the replica
- Blob hash, size, quota, and decompression-limit tests
- Conflict retention and no-overwrite tests
- Shared-agent sandbox escape, secret access, and egress tests
- Audit author, signature, membership-epoch, and tamper-evidence tests
- Side-by-side transcript and context-packet token-budget browser tests
- 20-participant soak and 128-member/presence simulation
- Format, lint, typecheck, unit, browser, server integration, and desktop build

No phase may ship by weakening the invariants at the top of this document.
