# Shared operator prompt presentation lanes

Status: read-only, web-only, injected, and default-unreachable. This child presentation slice sits
on the shared operator prompt timeline and does not create another client, request, cursor, cache,
or transport. Merged and side-by-side modes use the same already-decoded timeline snapshot, which
remains capped at 50 records per page, eight pages, and 400 retained prompt records.

## Presentation boundary

The merged view preserves authoritative project order. Side-by-side lanes use only the exact
current roster snapshot for attribution and preserve each operator's validated monotonic
`operatorSequence`. At most 20 participant lanes render simultaneously in a bounded horizontal
scroll region. If the authenticated roster is larger, an explicit first-lane selector moves that
full 20-lane window and clamps at the final complete window; it never expands the record or
transport bounds. Duplicate or long Unicode display names retain exact roster attribution while
assistive labels add only lane position, never user IDs. Prompts authored by operators who
are no longer in the current roster remain visible under the fixed former-operator attribution in
merged mode, but are not assigned to a current participant lane.

Tombstones remain bodyless in both modes and render only the fixed removal notice. Display names
come only from the strict current-roster snapshot. Presentation snapshots recheck exact plain
objects, dense arrays, immutable identities, canonical timestamps and hashes, project ordering,
and per-operator sequence advancement, then freeze their minimal output.

## Lifecycle and deferred composition

Project, client, current-user, permission, role, or roster replacement changes the render scope.
Old prompt bodies are hidden synchronously during render, pending work is aborted, late results are
dropped, and the presentation returns to merged mode before another scope can be shown. A null
client remains inert.

This view cannot send, replay, ingest, copy, subscribe, poll, schedule, persist, open a network or
filesystem path, start a process, or contact a provider or agent. Production composition still
requires the separately reviewed authenticated authored-message transport described by the parent
timeline seam.
