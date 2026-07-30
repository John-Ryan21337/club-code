# Auto Nudge behavior canon

Auto Nudge is default-off, paid automation for one exact environment/thread.
It is not a global project setting, an idle timer, a provider pacer, or a way to
interrupt work already running.

## Exact-thread policy

- The server stores mode, editable standing-order text, background choice,
  round cap, authority revision, and dispatch accounting on the exact thread
  projection.
- No thread inherits another thread's prompt, mode, caps, or background choice.
  A thread without an enabled policy is Off, and draft threads cannot run.
- Saving an enabled policy treats the current completed turn as a baseline; it
  cannot immediately authorize a send. Turning the policy Off also clears its
  background choice.
- The control loads the selected thread's policy, starts minimized, and remains
  limited to the chat-manuscript width while collapsed. Red means Off, green
  means On, and the animated cyan/green state means On with background
  continuation selected. Minimizing or opening Settings does not disable an
  enabled policy.
- The default is five automated rounds. The hard configurable bound is 1–20
  rounds.

## Built-in prompt policy

- The built-in prompts continue from the current thread context. They reconcile
  unresolved operator requests with the applicable handoff, plan, canon, and
  PR/backlog state instead of restarting discovery.
- Both modes keep coordination bounded. Linear owns actionable status,
  ownership, dependencies, and blockers; Notion owns durable decisions and
  research. Records are linked rather than duplicated and external state is
  refreshed only after a relevant change or when stale.
- Steady Progress permits at most two coherent lanes and targets the next
  verifiable slice. Hardcore Fanout permits bounded, non-overlapping lanes with
  one owner per lane and explicit convergence through repository gates and
  required independent audits.
- Both modes stop when work is complete or blocked, new authority is required,
  lanes contend, or additional context would cost more than it helps.
- These are editable starting prompts. Saving an edit changes only that exact
  thread; it never becomes project-wide policy.

## Event-driven authority

- Only a new, exact, provider-confirmed completed turn can authorize one
  automated follow-up. Elapsed idle time, route changes, settings changes,
  provider refreshes, and repeating timer ticks cannot create or renew that
  authority.
- Completion evidence is handed directly to the dispatcher, which rechecks all
  safety gates before transport. There is no nudge delay, countdown, elapsed
  run ceiling, or periodic dispatch cadence.
- Each independently opted-in thread can continue in the background. There is
  no single background owner and no project-wide prompt.
- At completion-event handoff, the dispatcher re-reads the exact authority revision,
  completed turn, thread policy, queue, provider readiness, caps, pending
  approvals or user input, plan state, errors, local exact-thread composer
  draft, and Stop state. Stale or missing evidence fails closed.

## Operator work and dispatch

- Once the server accepts an operator follow-up, its exact-thread FIFO queue and
  resulting provider work outrank Auto Nudge. A running, starting, connecting,
  or otherwise unsettled provider turn is never interrupted.
- An unsent draft is local to its renderer. The dispatching renderer checks its
  own exact-thread draft, but the server cannot reserve intent that another
  device has not submitted or acknowledge a remote draft it cannot see.
- Dispatch is rejected for archived/deleted threads, Off or stale authority,
  background sends without exact-thread opt-in, the configuration baseline,
  an already-consumed terminal turn, pending provider work, accepted manual
  FIFO work, or an exhausted/invalid cap.
- An accepted dispatch atomically records the exact completed turn, adds the
  editable standing-order text as an ordinary visible user message, and starts
  the next provider turn through the normal orchestration path.
- The client marks an exact terminal identity before an uncertain transport
  handoff and does not retry it. The server also serializes commands and checks
  the current revision, current completed turn, message id, and last-dispatched
  turn. A transport failure may skip one nudge; it must not cause duplicate
  paid sends.

## Stop, persistence, and scope

- Per-thread Stop revokes that thread's authority. Off, provider/config changes,
  archive/delete, manual work, and the hard round cap also prevent dispatch without
  sending a provider interrupt.
- Emergency Stop sets a durable browser/host suppression barrier and requests
  Stop for known connected threads. The background coordinator periodically
  re-reads that barrier so renderers on different local ports converge.
- The emergency barrier is not a server-global signal across unrelated
  machines. A device that has not received the barrier cannot know about it;
  operators must secure and monitor every client they authorize.
- Exact-thread policy and last-dispatched accounting are durable server
  projection state. A bounded 256-entry session-storage ledger provides
  additional renderer-local deduplication but is never dispatch authority.
- Corrupt, oversized, out-of-range, unknown, or unavailable state fails closed.

Every automated follow-up is a real provider request and may consume tokens,
credits, quota, or money quickly. Operators are responsible for provider
charges, and Club Code cannot reimburse consumed usage. Use conservative round caps,
carefully scoped exact-thread prompts or skills, and active monitoring,
including the phone Web UI when away.
