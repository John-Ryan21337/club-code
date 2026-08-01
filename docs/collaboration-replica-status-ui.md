# Managed replica status UI

Status: adoption-ready, web-only, read-only presentation boundary layered on the audited managed
replica storage head `98cf8eea891d0c65dcac1401b6258e3494916f6d`.

`CoworkReplicaStatusPanel` accepts an explicitly injected status client and the currently selected
shared-project identifier. It is not wired to HTTP, WebSocket, desktop IPC, the filesystem, or the
application navigation in this slice. A null client renders nothing and starts no effect, timer,
fetch, socket, RPC, or write. The host application can therefore adopt and review transport and
placement independently.

The panel exposes only bounded collaboration evidence:

- canonically sorted project-relative file names;
- immutable manifest heads and content hashes;
- preserved conflict forks and conflict audit references;
- recoverable tombstones;
- local materialization disposition; and
- explicit operator-attention reasons.

It never renders file bodies, provider output, credentials, private absolute paths, or backend
failure detail. The first slice has no delete, restore, materialize, fork-selection, or conflict
resolution control. Its disclosure states that limitation directly.

## Fail-closed model boundary

The pure status model accepts at most 50 entries per page, four pages, and 200 entries in one
mounted view.
Cursors, project identifiers, revisions, paths, attention text, hashes, forks, tombstones, and
conflict lists are independently bounded. Objects use an exact allowlisted shape, so a response
that adds a private path, body, credential, or unreviewed field is rejected rather than rendered.
Only plain data-property objects and dense plain arrays are admitted: inherited fields, symbols,
accessors, sparse arrays, and collection subclasses fail closed before any response value is used.

Every response must name the currently selected project. Entries must be canonically ordered and
unique under the same portable filesystem alias fold used by replica admission. Paths also retain
the shared-replica UTF-8, Unicode scalar, segment, and Windows reserved-name limits. Entry revisions
cannot exceed the project revision. Pagination must retain the same project revision, use the exact
requested cursor, remain globally ordered, and never repeat a path.
Heads, forks, and tombstones cannot reuse a revision identity; version evidence requires a content
hash while tombstones forbid one. Conflicts and failed materializations require explicit operator
attention that matches the displayed evidence. Revision identities also cannot be reused by another
path or page in the mounted view. Attention reasons are fixed codes mapped to local UI copy, not
backend-provided prose, so provider output, credentials, or other arbitrary text cannot enter
through that field.

Changing projects or unmounting aborts the in-flight request and advances a request sequence.
Responses from an older request, a previous project, a React StrictMode setup pass, or an unmounted
panel cannot update the current view. There is no polling or background refresh in this slice.

## Adoption seam

The injected client implements one query:

```ts
listReplicaStatus({ sharedProjectId, cursor, limit, signal }): Promise<unknown>
```

The transport adapter must return the allowlisted page shape and honor `AbortSignal`. It remains
responsible for authenticating the operator, resolving current membership, projecting only that
project's status, and issuing opaque SHA-256 audit references. The adapter must not translate local
storage paths or file contents into this response. A future mutation UI requires a separate threat
model, authorization boundary, confirmation design, and audit.
