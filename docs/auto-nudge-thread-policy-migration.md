# Auto Nudge per-thread policy migration

This change replaces the original device-wide execution policy with a bounded,
local per-thread registry.

## Stored data

| Purpose                                                                | Storage        | Key                                       |
| ---------------------------------------------------------------------- | -------------- | ----------------------------------------- |
| Per-thread mode, background choice, and caps                           | `localStorage` | `cafe-code.auto-nudge.thread-policies.v2` |
| Once-per-terminal-turn claims                                          | `localStorage` | `cafe-code.auto-nudge.consumed-turns.v2`  |
| Single background owner, captured run policy, bounds, and audit ledger | `localStorage` | `cafe-code.auto-nudge.background.v1`      |

The background key remains at v1 because its existing envelope is extended
compatibly with `runPolicy` and `baselineTerminalTurnKey`; records without a
captured run policy are treated as legacy. At the PR7 head, ownership/state may
be migrated but root dispatch still pauses before observation because durable
exact-thread manual FIFO truth is not yet available.

## Upgrade behavior

1. Unknown threads start Off. The legacy global mode is never copied to every
   thread and never becomes a focused-thread default.
2. If a persisted legacy background run has an exact owner but no captured
   policy, the root coordinator may migrate the legacy mode and caps only when
   the old background-continuation setting is enabled. It writes one policy for
   that exact owner while holding the execution lock.
3. A legacy owner that cannot be migrated has no valid run policy and stops
   fail-closed.
4. Existing session-scoped consumed-turn keys are copied once into the durable
   v2 ledger when no v2 ledger exists, then removed from `sessionStorage`.
5. Explicitly turning a migrated thread Off writes a per-thread Off policy.
   Stale legacy global settings cannot reactivate it because an explicit
   per-thread entry now exists.

The legacy client-setting fields remain decode-compatible during rollout, but
they are migration input only. Foreground and background scheduling must not
consult them after an exact per-thread policy exists.

## Rollback and validation

Older builds ignore the new policy and ledger keys. Rolling back can therefore
restore the old global behavior; it does not delete v2 data. Before release,
validate:

- enabled Thread A remains enabled through settings and thread navigation;
- Thread B displays Off while A owns background state;
- disabling B does not stop A;
- disabling A stops only A;
- enabling/remounting on an existing completed turn only baselines it;
- a later changed exact terminal identity creates at most one foreground claim;
- the root coordinator pauses before observation/transport while exact-thread
  manual FIFO truth is unavailable;
- a running provider turn is never interrupted or replaced; and
- corrupt or oversized persisted values produce an Off/stopped state.
