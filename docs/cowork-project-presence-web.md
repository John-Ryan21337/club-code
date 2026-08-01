# Project presence web roster

`ProjectPresenceRosterModel` is a disabled-by-default, web-only view model. It performs no fetch, polling, socket, RPC, or launcher work: callers must explicitly inject a subscription client and call `start`.

It replaces local state on authoritative snapshots, accepts only the next delta version, and marks gaps for resync. Multiple device sessions collapse into one participant with coarse online/away/offline state and the two safe capabilities. The normal display is capped at 20 participants; protocol input is capped at 128. It exposes loading, unavailable, and resync-required states for an accessible host component.

The model deliberately cannot carry prompts, paths, provider/model output, tasks, device keys, credentials, or activity history. `stop` is required on unmount or project/session changes and invokes the injected unsubscribe exactly once.
