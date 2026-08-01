# Shared operator prompt timeline adoption seam

Status: read-only, web-only, injected, and default-unreachable. This child slice uses the audited
shared authored-message contracts and read seam from the shared operator chat UI, but requests only
the `authored-prompt` kind. It opens no fetch, socket, endpoint, RPC, filesystem path, process,
provider, agent, subscription, or timer. Without an injected client, it renders nothing.

## Exact visible boundary

The timeline displays project-visible operator prompts as escaped text with the authenticated
author's project display name, per-operator order, authoritative project order, and authored time.
Tombstoned prompt bodies are replaced with a fixed removal notice. The admitted UI snapshot retains
only message ID, author user ID, the two sequence numbers, visible body or tombstone state, authored
time, and immutable message hash.

There is deliberately no prop or state field for provider output, assistant text, private chat,
system prompts, hidden thread history, files, paths, credentials, model settings, context packets,
task bodies, or agent state. The component never sends, retries, replays, copies, summarizes, or
injects a prompt into a model context. It is not an agent context-ingestion feature.

## Bounded and strict reads

Each injected read requests exactly one project, the exact admitted cursor, `authored-prompt` only,
and at most 50 records. The view stops after eight pages and 400 retained prompts even if the server
reports more history, and each admitted page must remain inside the authored-message retained UTF-8
byte budget. It performs no background polling or live subscription.

Before a response can enter React state, the decoder requires exact plain data objects and dense
plain arrays. It rejects accessors, subclasses, symbols, excess fields, non-prompt records,
cross-project records, invalid identifiers/hashes/timestamps/bodies/tombstones, inconsistent merged
order or operator-lane positions, cursor regressions, contract integer overflow, duplicate
identities, cross-page replay, and per-operator sequence regression. Synchronous transport throws
and hostile thenables are contained behind the same fixed failure state. Accepted entries and pages
are minimal frozen snapshots. A project/client/roster change aborts the old request, clears state,
invalidates late results, and is hidden at render time before effect cleanup so the previous scope
cannot flash under replacement project or operator props.

The roster is independently snapshotted under the 128-member contract bound. Invalid or duplicate
members and attribution control characters fail closed before any client read. The current operator
must still be present with explicit `transcript.read` permission. Role, permission, and joined-time
changes replace the render scope and clear retained prompts. Authors no longer in the supplied
current roster are shown using a fixed former-operator label; prompt payload text cannot manufacture
a display name. Visible authored text is rendered as escaped, bidi-isolated plain text.

## Deferred production composition

An adopter may compose the injected client only after a separate transport review confirms that
the server resolves current project membership and `transcript.read` authority, decodes the same
contracts, honors cancellation, and never broadens this seam into the server-wide orchestration
RPC. Live updates should be a separate bounded, sequence-monotonic subscription slice; they must not
add polling or copy the prompt transcript into agent/model context.
