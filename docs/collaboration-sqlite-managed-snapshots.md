# Managed SQLite snapshots for co-working

Club Code must never byte-merge live SQLite pages. Two operators can safely work with the same
declared SQLite database only through the serialized database-head authority and immutable,
transactionally consistent snapshots.

`CollaborationSqliteManagedSnapshot` is a narrow server adapter for that path. Capture uses
Node's native `node:sqlite` online backup API (`sqlite3_backup_*`), so committed WAL state is
consolidated into one standalone SQLite file while the source remains readable. It does not copy
`-wal`, `-shm`, `-journal`, attached databases, or arbitrary workspace paths.

## Capture boundary

Before and after backup, the adapter checks current membership, active device-key authority, the
declared SQLite binding, writer lease, fencing token, membership epoch, and expected canonical
head. The second check requires the exact enrolled device-key bytes to remain unchanged under the
same key ID and fails closed if the server clock moves backward. It revalidates the sandbox path
and source file identity, rejects links and case aliases, and bounds both one backup and retained
artifact/staging/recovery bytes with a per-database quota. The produced artifact is content-addressed and is
accepted only after SQLite integrity, schema hash, application/user version, page geometry, and
file hash checks. A head change during capture retains the artifact as an explicit conflict fork;
it does not silently advance the head.

The caller must publish a `head-candidate` through the existing database-head compare-and-swap
store. This adapter deliberately does not mutate database authority.

## Restore boundary

Restore requires a production quiescence authority that prevents every local database client from
opening or using the managed replica for the complete operation. A filesystem lock or rename is
not sufficient because a POSIX process can retain the old inode. The adapter then:

1. resolves the artifact only from project, database, and content hashes inside managed storage;
2. rechecks its hash, integrity, identity metadata, current head, lease, fence, membership, device
   key bytes, replica hash, sandbox containment, and case-insensitive absence of sidecars;
3. copies into a no-follow exclusive staging file;
4. freshly revalidates the replica/root identity and sidecar absence after the asynchronous copy,
   then retains the prior replica as a recovery hard link and atomically replaces the managed replica;
5. validates the installed database and checks authority again, rolling back on any late change.

Busy, corrupt, unsupported, oversized, missing, changed-authority, and sidecar-active cases fail
closed. A changed local replica or non-head selection returns an explicit forkable conflict and
does not mutate the file.

## Wiring constraints

This slice intentionally provides no network listener, UI, arbitrary path selector, or generic
database merge. Production wiring must inject the durable database-binding authority and a
quiescence authority shared by every local SQLite opener. The adapter operates only beneath an
already-authorized managed replica root. External-service databases remain API-only, and unknown
engines remain private forks or engine-specific logical exports.

The included mutex is process-local. Production enablement must add a cross-process exclusion
backend and durable, request-bound operation receipts before more than one server process may own
the same managed replica. The current `operationId` is a transport correlation field, not a claim
of restart-durable idempotency. Recovery artifacts are intentionally retained and count against
the configured per-database storage quota; a separately reviewed retention UI/policy must decide
when an operator-authorized recovery copy may be removed.
