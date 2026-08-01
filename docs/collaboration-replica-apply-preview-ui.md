# Managed replica apply preview and approval UI

Status: adoption-ready, web-only, injected UI seam layered on the audited read-only replica status
head `bc176c068dc83ed8c4962370fb8020df7012715c`.

`CoworkReplicaApplyPreviewPanel` accepts the selected shared-project identifier and an explicitly
injected client. It is not wired to application navigation, production RPC, HTTP, WebSocket,
desktop IPC, filesystem APIs, provider sessions, or an authoritative apply runner in this slice.
A null client renders nothing and starts no request, timer, subscription, process, agent, or
command. Production apply is therefore unreachable by default.

This slice exposes two narrow client operations:

```ts
previewReplicaApplyPlan({ sharedProjectId, cursor, limit, signal }): Promise<unknown>
approveReplicaApplyPlan(exactFrozenCommand, { signal }): Promise<unknown>
```

The host also injects `createCommandId()`. It is called only after the operator loads the complete
plan, reviews the fixed disclosure, checks the confirmation box, and selects **Approve exact
plan**. The UI creates one frozen command object. If the acknowledgement is indeterminate, the only
retry control resends that same object with the same command ID and plan token. It never generates
a replacement command for a retry.

## Immutable authority binding

Every page and the eventual approval command bind the exact:

- shared project and device identifiers;
- membership epoch;
- manifest revision, current manifest-head hash, and expected base-manifest hash;
- positive fencing value;
- content-addressed plan hash; and
- opaque plan token.

At most 50 outcomes are accepted per page, four pages and 200 outcomes per mounted preview. The
complete plan is limited to 1 TiB of summarized content. Pagination must retain every authority
binding and the exact summary, advance opaque cursors, stay globally canonically ordered, and avoid
portable filesystem aliases. Approval remains disabled until the terminal page is loaded and its
entry counts and bytes exactly reconcile with the immutable summary.

Transport data is decoded through exact plain-object and dense plain-array allowlists. Accessors,
symbols, inherited properties, sparse arrays, subclasses, arbitrary prose, absolute paths,
traversal, non-canonical Unicode, unpaired surrogates, Windows device aliases, unexpected fields,
and oversized data fail closed. Responses are copied into deeply immutable views before rendering.

## Explicit planned outcomes

The plan uses fixed local labels, not backend prose, for:

- publish only while the manifest head matches;
- apply or tombstone only while the expected local base hash matches;
- consolidated immutable database snapshots;
- skipped WAL, SHM, and journal sidecars;
- preserved conflict forks with audit references; and
- preserved local files when overwrite is forbidden.

Any WAL, SHM, or journal path presented as a content action is rejected. A database snapshot must
have matching content and snapshot hashes. Tombstones cannot carry content. Conflict outcomes
require both an expected base and an audit reference. The UI receives no file bodies and performs
no recursive source-workspace discovery or path selection.

## Receipt-only truth and fail-closed recovery

An `accepted` or `replayed` response is displayed only as an approval receipt. It is never rendered
as proof that any file was materialized, deleted, published, or synchronized. Applied truth must
come from a separately authenticated status projection after the authoritative runner completes;
that runner and refresh composition are outside this slice.

An explicit `authority-changed` response discards the command and refreshes the preview. A receipt
whose project, device, membership epoch, manifest revision/head/base hashes, fence, plan token,
plan hash, or command ID differs from the frozen command is malformed: the UI discards the old plan
and refreshes. A definitive rejection clears the command and claims no applied outcome. A transport
throw is treated as an indeterminate acknowledgement, preserves the exact command for explicit
retry, and also offers **Discard and refresh**. There is no automatic retry, polling, background
refresh, or timer.

The production transport adapter remains responsible for authenticating the operator, resolving
current project membership and device authority, issuing and expiring content-addressed plan
tokens, enforcing fencing and base-hash compare-and-swap, storing an idempotent command receipt,
and scheduling any separately audited apply operation. It must reject stale authority before a
write and must never accept arbitrary local paths, live SQLite/WAL/SHM/journal synchronization,
overwrite-on-conflict, or source-workspace recursion.
