# Auto Nudge canon

Auto Nudge is an operator-controlled continuation policy. It MUST NOT interrupt a running provider
turn, answer an approval or structured question, bypass queued work, or send while the selected
provider is unavailable or exhausted.

## Foreground continuation

The selected mode is a durable device setting. When the visible server thread reaches a
provider-confirmed terminal turn, the renderer MAY schedule one five-second foreground nudge for
that exact opaque turn ID. It MUST repeat all eligibility checks at dispatch time and consume the
turn before transport handoff so replayed completion events cannot create duplicate nudges.

The foreground timer belongs only to the currently visible thread. Route navigation cancels that
timer without disabling the saved mode. Manual prompt edits, attachment changes, sends, steering,
pending approvals, pending structured questions, proposed-plan follow-up, queued work, provider
unavailability, and account exhaustion cancel or block dispatch.

## Background continuation

"Continue this thread in background" is a separate, explicit opt-in. It owns at most one exact
environment/thread pair and remains active when the operator selects another route. Navigation,
component unmount, settings-panel visibility, and ordinary renderer remounts MUST NOT be treated as
operator cancellation.

Enabling background continuation MUST be durably confirmed before ownership starts. Explicit
disable, Stop, manual activity in the owned thread, pending operator work, provider trouble,
missing/archived ownership, an invalid clock transition, or an exhausted time/round cap stops or
pauses the run fail-closed.

Every background dispatch MUST hold a cross-window exclusive lock, reload durable ownership, claim
the terminal turn durably, and then cross the transport boundary. If durable storage, the Web Locks
API, or transport is unavailable, the feature pauses instead of risking a duplicate. The bounded
ledger MUST identify the owner, terminal turn, message, result, rounds, and stop/pause reason.

Foreground and background dispatches derive the same command and message identities from the exact
terminal turn. The server MUST accept an automated turn start only while that same turn remains
completed and settled; it must reject the command rather than reinterpret it as a steer if work
started during renderer projection lag.

An enable request remains valid while its initiating thread view unmounts. A later explicit
operator request may supersede it; route navigation alone may not.

## Platform behavior

The policy is platform-neutral in the Electron renderer on Windows 10/11, macOS, Arch Linux,
Ubuntu/Kubuntu, and Raspberry Pi OS arm64. Background mode requires the Chromium Web Locks API and
writable local storage; unsupported or storage-denied browser contexts expose the limitation and
fail closed.
