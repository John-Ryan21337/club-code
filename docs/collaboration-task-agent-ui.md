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
mismatched or replayed request attempts, cursor cycles, out-of-chain cursors, mismatched
projects/command IDs/task IDs, non-exact command revisions, and oversized pages. Tasks and command
requests are copied and frozen before retention so an injected adapter cannot mutate accepted UI
authority after a request begins. Tasks are deduplicated by opaque task ID and advance only when
revision, fencing token, immutable authored fields, update time, and any continuing lease membership
epoch remain monotonic. Conflicting snapshots disable mutation until an authoritative refresh. A
command ID is permanently bound to one project, task, operation, and expected revision within the
mounted model; reusing it for different intent produces a conflict, while an indeterminate retry
reuses the same frozen request object and ID. Only one command attempt per task may be in flight.

React lifecycle cleanup invalidates all outstanding page and command tickets. The model can then
reactivate for React StrictMode's development effect replay without accepting results from the
disposed generation; a real project switch or unmount likewise makes late responses inert.

At most eight recorded agent leases are expanded. The panel deliberately does not infer current
liveness from renderer wall-clock time: the server remains authoritative for whether a recorded
lease is still active. Additional lease records remain represented by an explicit capped count and
hidden-state label, matching the server authority's eight-live-agent project limit without creating
an unbounded renderer surface.

## Deliberate non-goals

This slice does not add task creation/editing, presence, operator chat, file sync, transport,
subscriptions, polling, automatic refresh, agent admission, provider selection, or execution.
Those capabilities need separate authenticated server and application-shell adoption slices.
