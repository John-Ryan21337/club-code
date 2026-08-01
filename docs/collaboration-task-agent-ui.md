# Shared task and agent coordination UI

This slice adds an adoption-ready, web-only projection of the shared task authority. It is not
wired into the application shell. `SharedTaskAgentPanel` requires an explicitly injected
`SharedTaskAgentClient`; a `null` client renders nothing and performs no timer, fetch, socket, RPC,
provider, agent, or process work.

The panel displays only contract-approved operator-authored task fields: title, opaque task and
user identifiers, state, dependencies, revision, fencing token, and bounded active-agent lease
metadata. It does not render the task body, device identity, private filesystem paths, provider
output, prompts, credentials, or agent tool output. An active lease is labelled `Admission: not
started`; the UI never launches or admits an agent.

## Adapter boundary

An integrating transport must:

- authenticate and authorize the current device outside the renderer component;
- schema-decode task records against `CollaborationSharedTask` before returning them;
- page only the current shared project, with at most 128 tasks per response;
- echo the exact request cursor and shared-project ID in each page;
- translate the narrow `claim` and `complete` UI requests into the server authority's authenticated
  commands without returning device keys or other secret material;
- preserve the supplied command ID exactly across an indeterminate acknowledgement retry; and
- return only the matching project, command ID, task ID, and authoritative updated task.

The pure coordination model rejects stale project generations, responses after disposal,
mismatched cursors/projects/command IDs/task IDs, and oversized pages. Tasks are deduplicated by
opaque task ID and advance only by revision. Two different task snapshots at the same revision are
shown as an explicit conflict and disable mutation until refresh. A command ID is permanently bound
to one project, task, operation, and expected revision within the mounted model; reusing it for
different intent produces a conflict, while a retry reuses the same request object and ID.

At most eight active agent leases are expanded. Additional leases remain represented by an
explicit capped count and hidden-state label, matching the server authority's eight-live-agent
project limit without creating an unbounded renderer surface.

## Deliberate non-goals

This slice does not add task creation/editing, presence, operator chat, file sync, transport,
subscriptions, polling, automatic refresh, agent admission, provider selection, or execution.
Those capabilities need separate authenticated server and application-shell adoption slices.
