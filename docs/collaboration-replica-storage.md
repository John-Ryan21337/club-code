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
  manifest digest, and observed digest must all agree.
- Incomplete bytes are staged with exclusive creation, flushed, and promoted with an atomic
  create-if-absent hard link. This cannot overwrite a blob raced into the same digest slot.
  Known crash-stage files are cleaned idempotently without recursive deletion.
- Replica files are assembled from reverified blobs into an exclusive same-directory stage,
  flushed, and replaced atomically where the platform supports it. Windows replacement first
  moves the previous managed file to recovery so a failed second rename can be rolled back.

## Filesystem safety

The replica root and blob root are captured by canonical identity and rechecked during each
operation. Each existing ancestor must have the exact requested case, remain under the root,
and not be a symlink, junction, reparse-point traversal, or non-directory. Existing file
targets and stored blobs must be ordinary single-link files. Windows device names, alternate
data streams, absolute paths, traversal, non-NFC paths, ambiguous case aliases, and the
reserved `.club-code-managed` subtree are refused.

Tombstones never recursively or irreversibly delete local content. An admitted tombstone moves
the exact ordinary file into a project/version-scoped recovery directory. A retry after that
move is an idempotent no-op. Directories are never treated as tombstone file targets.

SQLite/database live pages and volatile sidecars (`-wal`, `-shm`, `-journal`, and equivalents)
are not accepted by this byte plane. Database collaboration must use the separate serialized,
fenced snapshot authority; generic last-writer-wins file copying is not safe for databases.

## Residual boundary

Node does not provide a portable `openat`/`renameat` API that pins every ancestor directory
handle through commit. The implementation therefore combines canonical root identity,
exact-entry enumeration, no-follow file opens, single-link enforcement, repeated containment
checks, same-directory staging, and an authority check immediately before commit. A privileged
or same-account external process that can continuously rewrite the managed roots can still
contend with those checks. Production deployment must place these roots inside the project OS
sandbox with permissions that exclude unrelated processes; this service is not a substitute
for that sandbox.

Public failures report only operation and a bounded reason code. They never include local
paths, uploaded bytes, credentials, membership detail, or authorization internals.
