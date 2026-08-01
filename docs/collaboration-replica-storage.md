# Managed collaboration replica storage

Status: server-only storage boundary. This slice deliberately exposes no HTTP, WebSocket,
desktop IPC, agent, or UI entry point.

The managed replica storage is the byte plane beneath the collaboration file metadata
authority. It never accepts a client-selected destination, digest, or version in isolation.
Every upload and materialization is tied to an admitted project-relative path, device key,
current immutable version, and exact manifest chunk from `CollaborationFileSyncStore`.
Membership, device revocation, sandbox containment, and the current head are revalidated
before filesystem commit.

## Storage and quota boundaries

- Blob bytes are content-addressed by SHA-256 inside a server-selected per-project bucket.
- An upload frame is at most 1 MiB, an admitted storage chunk is at most 8 MiB, a locally
  materialized file is at most 1 GiB, and a project blob bucket is capped at 20 GiB. Server
  configuration may lower, but not raise, these ceilings.
- Uploads are consumed sequentially with bounded buffers. Declared length, observed length,
  manifest digest, and observed digest must all agree. Cancellation also races a pending iterator
  pull, so a stalled producer cannot indefinitely pin a stage file or quota reservation.
- Quota bytes are reserved before an upload source is consumed. Concurrent uploads handled by
  one storage service therefore cannot overcommit either completed blobs or in-flight staging;
  duplicate uploads of the same content digest share one reservation.
- Incomplete bytes are staged with exclusive creation, flushed, and promoted with an atomic
  create-if-absent hard link. This cannot overwrite a blob raced into the same digest slot.
  Known crash-stage files are cleaned idempotently without recursive deletion.
- Replica files are assembled from identity-checked, reverified blobs into a fixed-length,
  exclusive stage under the reserved managed subtree. This keeps valid maximum-length user file
  names from overflowing a filesystem component. The stage is flushed before commit and known
  crash stages are cleaned on service startup.
- Replacement first moves the previous ordinary file to recovery on every platform. A failed
  install restores it. If membership, device authority, or the current head changes during the
  filesystem commit, the newly installed file is moved to recovery and the prior file is restored.
  Same-project, same-path version and tombstone commits are serialized within the service.

## Filesystem safety

The replica root and blob root are captured by canonical identity and rechecked during each
operation. Each existing ancestor must have the exact requested case, remain under the root,
and not be a symlink, junction, reparse-point traversal, or non-directory. Existing file
targets and stored blobs must be ordinary single-link files. Windows device names, alternate
data streams, absolute paths, traversal, non-NFC paths, ambiguous case aliases, and the
reserved `.club-code-managed` subtree are refused.

Tombstones never recursively or irreversibly delete local content. An admitted tombstone moves
the exact ordinary file into a project/version-scoped recovery directory. A retry after that
move is an idempotent no-op. The target type and current head are checked again immediately before
the move. Directories are never treated as tombstone file targets, and a current-head change after
the move restores the file from recovery.

SQLite/database live pages and volatile sidecars (`-wal`, `-shm`, `-journal`, and equivalents)
are not accepted by this byte plane. Database collaboration must use the separate serialized,
fenced snapshot authority; generic last-writer-wins file copying is not safe for databases.

## Residual boundary

Node does not provide a portable `openat`/`renameat` API that pins every ancestor directory
handle through commit. The implementation therefore combines canonical root identity,
exact-entry enumeration, no-follow file opens, single-link enforcement, repeated containment
checks, managed-root staging, and authority checks immediately before and after commit. A privileged
or same-account external process that can continuously rewrite the managed roots can still
contend with those checks. Production deployment must place these roots inside the project OS
sandbox with permissions that exclude unrelated processes; this service is not a substitute
for that sandbox.

Quota reservations and same-path commit mutexes are process-local. Multiple server processes must
not point at the same blob or replica roots until a cross-process lock or transactional storage
backend is added; otherwise their independent reservations cannot provide a single global quota.
Recovery files are intentionally retained rather than automatically deleted, because silent
irreversible cleanup would violate the managed-replica safety boundary.

Public failures report only operation and a bounded reason code. They never include local
paths, uploaded bytes, credentials, membership detail, or authorization internals.
