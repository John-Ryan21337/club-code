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

Database containers receive stricter treatment than ordinary binary files.
Club Code never copies a live database file between peers and never replicates
known live sidecars, including SQLite `-wal`, `-shm`, rollback/super-journals,
DuckDB `.wal`, or LMDB `lock.mdb`. An unknown database engine must use a proven
offline copy or logical export because generic sidecar discovery is not a safe
consistency boundary. Projects choose one of three explicit coordination modes:

1. `external-service` (preferred for client/server databases): one database
   service owns transactions and users collaborate through its authenticated
   API; database-file replication is forbidden.
2. `private-forks` (default for embedded or arbitrary database files): each
   operator writes a private local copy. A consistent backup or logical export
   becomes an immutable snapshot, and changes converge through an
   application-aware changeset or explicit export/import review.
3. `serialized-head` (compatibility mode): a short, renewable,
   server-authoritative single-writer lease controls only the canonical shared
   head. Every accepted head update is a compare-and-swap against the prior
   content hash and carries a monotonically increasing fencing token, so a
   paused or partitioned former writer cannot publish after its lease expires.

Other operators may keep working concurrently in private forks even when a
canonical-head lease is held. Club Code produces snapshots through an engine's
online backup API, a checkpoint copy made while engine writes are held and
quiesced, an offline copy, or a logical export; completing a checkpoint and
then copying a database that remains live is not a consistent snapshot.
Generic row-level merging is impossible without understanding the database
schema and application invariants, so an unresolved changeset is kept as a
reviewable conflict artifact instead of being guessed or overwritten.

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
  centralized server authorization boundary. Membership snapshots are not
  accepted as command input: the boundary requires a server-provided current
  membership authority and uses the server clock. It rejects cross-project
  access before membership lookup, stale epochs, sessions outside their
  validity window, non-positive or greater-than-one-hour access-session
  lifetimes, removed members, and permissions absent from either the member
  grant or role ceiling.
- Focused contract and server tests cover principal serialization, the
  cross-project IDOR matrix, epoch revocation, membership removal, session
  validity, and permission narrowing.
- Migration 070 and `CollaborationEventStore` durably persist only admitted
  events in a strict SQLite journal. Each project receives an independent
  monotonic sequence and SHA-256 hash chain; exact idempotent retries return the
  original event, while command-ID reuse with different content fails closed.
  Replay is reauthorized on every call, capped at 500 events and 1 MiB of
  encoded data, and validates project scope, contiguity, cursor alignment, and
  stored hashes before returning data.
- Append recomputes the proposal hash, preserves the verified device-key
  identity, and repeats admission after reserving the SQLite writer so a
  membership or key revocation observed before commit prevents the append.
  Two independent mutation-authorized audits added forged-admission,
  cross-project replay, concurrent-writer, revocation-race, corrupt-chain, and
  malformed-page regressions.
- Migration 072 and `CollaborationMembershipStore` provide server-clock,
  single-use invitations and epoch-incrementing role/removal mutations. Invite
  secrets are stored only as digests and mutation receipts are bound to the
  authenticated user and device.
- Migration 073 and `CollaborationDeviceKeyStore` provide durable per-project
  device enrollment. The server generates a one-use 256-bit challenge nonce,
  stores only its domain-separated digest, and activates a key only after a
  canonical Ed25519 SPKI key verifies the challenge signature. Enrollment and
  event admission decode the compressed point and require the non-identity
  prime-order subgroup before using OpenSSL: DER/type round trips alone are not
  sufficient because OpenSSL accepts forged signatures for low-order Ed25519
  public keys. Rotation revokes
  the prior key before inserting its replacement in one SQLite writer
  transaction; an index enforces at most one active key per project/device.
  The event-admission authority returns a key only when project, user, device,
  key ID, current member, and current membership epoch all match. Any membership
  epoch change makes older enrolled keys unusable until re-enrollment, preventing
  removed-and-reinvited identities from resurrecting an old key.
- Device command receipts include user, device, and membership epoch. Stored
  challenges, keys, receipts, actor identity, proof transcript, and their
  canonical hashes are cross-checked on replay; corrupt public-key bytes or
  timestamps fail closed. Adversarial tests cover low-order-key forgeries and
  validly rehashed receipt substitution. File-backed two-client tests exercise
  competing rotations plus revoke-versus-rotate races and prove exactly one key
  remains current.
- `getCurrentDeviceKeyStatus` is the authenticated, server-only discovery
  boundary for a later device-management UI. Its request carries only the
  project ID; user and device identity come from the validated principal and
  are rechecked against current membership, membership epoch, and the durable
  project/device binding under the same project writer lock used by rotation
  and revocation. The response is bounded to identity, current epoch, status,
  key ID, and activation time. It never exposes key bytes, enrollment nonces,
  digests, receipt hashes, or another device. A stale-epoch key reports
  enrollment required, while missing device bindings or malformed/substituted
  key and enrollment-challenge lineage fail closed. The returned key ID can be
  passed to the existing self-only, actor/epoch/request-bound idempotent
  revocation command; a key from an older membership epoch cannot be revoked as
  though it were current authority.
- `packages/contracts/src/fileSync.ts` defines conflict-safe database
  coordination modes, portable normalized replica paths, consistent immutable
  snapshot descriptors, bounded writer leases, and identity-bound
  compare-and-swap head updates whose expected hash matches the snapshot base
  and whose fencing tokens remain exact integers. These are contracts only; no
  live database file is copied.
- Coordinator transport, network enrollment endpoints, subscriptions,
  chat/transcript UI, OS-backed private-key generation/storage, sandboxed agent
  runners, file synchronization/materialization, and signed checkpoints remain
  unimplemented. The current storage slice stores public keys only, exposes no
  network endpoint, and mutates no shared project file.

Residual boundary: exact revocation linearizability must be revisited if
membership or key authority moves to a remote non-transactional service.
Sequence-only clients must also retain and verify their prior hash anchor until
signed checkpoints or equivalent key-history proofs are implemented.
Expired enrollment challenge cleanup is deferred to a bounded maintenance job;
expiry is enforced on every completion, so retained rows grant no authority.

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
- `packages/contracts/src/collaborationDevice.ts`
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
