# Idle Thread Guard behavior canon

Idle Thread Guard is a default-off, exact-thread inactivity safeguard. It is a
separate feature from Auto Nudge: its wall clock can never authorize an Auto
Nudge handoff, consume a completed-turn Auto Nudge authority, or change Auto
Nudge mode, prompt, rounds, or background continuation.

## Safety and dispatch

- The hard accepted range is 1–720 whole hours; malformed persisted values are
  clamped to at least one hour. The default is two hours.
- Enabling starts a fresh deadline at opt-in time, so an already-old thread
  cannot send immediately.
- The Guard considers only a non-archived thread with an exact running session,
  active running turn, no pending approval or user input, no actionable plan,
  no thread error, and no accepted manual follow-up.
- Any newer projected thread, transcript, tool/activity, turn, or session
  timestamp resets the deadline. Continuous output therefore prevents a send.
- One idle episode may produce at most one visible status request. The Guard
  persists a one-shot barrier before transport and cannot re-arm until newer
  provider activity is projected. An indeterminate or rejected transport fails
  closed instead of retrying paid work.
- The request uses the normal exact-thread steer path and remains visible in
  the transcript. It does not interrupt or stop the provider.

## Scope and limitations

Configuration is renderer-local and exact-environment/thread scoped. A running
authenticated Club Code renderer coordinates all currently connected thread
shells known to that renderer. It is not yet a server-durable, cross-device
policy; closing every renderer stops observation rather than creating a hidden
background service.

Every fired status request can consume provider tokens, credits, quota, or
money while a provider is silently doing long work. The UI therefore warns
against aggressive values, refuses values below one hour, and recommends
multi-hour or multi-day thresholds such as 2–48 hours.
