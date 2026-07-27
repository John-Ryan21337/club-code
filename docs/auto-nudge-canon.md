# Auto Nudge behavior canon

Auto Nudge is an explicit, per-thread automation policy. It is not a global
provider pacer and it must never stop, interrupt, or replace work that is
already running.

## Thread policy

- A policy is keyed by the exact environment id and server thread id.
- A thread without a stored policy is Off. It does not inherit the mode,
  background choice, or limits of the focused thread or any other thread.
- Mode, background continuation, maximum rounds, and maximum minutes survive
  route changes, settings navigation, renderer reloads, and app restarts.
- Draft threads cannot run Auto Nudge.
- Turning a thread Off disables its background-continuation choice. It does not
  change another thread's policy or stop another thread's run.
- The control always renders the selected thread's policy. Its background
  switch is checked only when that exact thread owns the active background run.

## Scheduling and dispatch

- Foreground and background dispatch require the same exclusive Web Lock.
  Automatic dispatch is unavailable when the runtime cannot provide that lock.
- The dispatcher reloads the target thread's durable policy and consumed-turn
  ledger while holding the lock. It must not rely on a React closure, the
  currently visible thread, or device-wide client settings.
- A nudge is eligible only for a provider-confirmed completed turn when the
  session and provider are ready and there is no draft text, attachment,
  queued follow-up, approval, user-input request, plan prompt, transport error,
  or other pending work.
- A running, starting, connecting, or otherwise unsettled provider agent is
  never interrupted. The scheduler waits for a later settled observation.
- The terminal turn is claimed durably before transport handoff. A failed
  handoff may skip one automated nudge, but a reload or second window must not
  submit the same terminal turn twice.
- A visible-thread countdown is canceled on navigation. Returning to the
  thread re-evaluates its unchanged policy and latest terminal turn.
- Background continuation has one owner. Transferring ownership clears the
  former owner's background-continuation choice but preserves its mode and
  limits.
- Background execution uses the policy captured for its owner. Policy updates
  are synchronized only when their thread identity matches that owner.
- Manual activity, queued work, provider unavailability, a missing/archived
  owner, an invalid clock transition, or a missing projection acknowledgement
  pauses or stops the bounded run without interrupting provider work.

## Bounds and persistence

- Per-thread policies are limited to 256 most-recently-updated entries.
- Foreground terminal-turn consumption is limited to 256 entries.
- The visible background audit ledger is limited to 40 entries while retaining
  sent-turn identities needed for deduplication. Each new record carries its
  exact owner, and the UI shows only records attributable to the selected
  thread.
- Corrupt, oversized, out-of-range, or unknown persisted values fail closed.
- Current Chromium-based Electron builds provide Web Locks on Windows 10/11,
  macOS, and supported Linux distributions, including arm64 builds. Browser or
  embedded runtimes without Web Locks may edit policy but cannot automatically
  dispatch.
