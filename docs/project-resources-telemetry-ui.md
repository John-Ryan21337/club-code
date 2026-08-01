# Project Resources telemetry UI

Status: renderer/client adoption seam. This slice is intentionally not mounted into Cafe Code and
opens no endpoint. Adoption requires a separately reviewed, authenticated, project-authorized
transport implementation of `ProjectResourcesTelemetryClient`.

## Truthful rendering

The panel presents only the host CPU and host memory measurements defined by the telemetry
foundation. An available measured zero is displayed as `0%` and retained in graph history. Warming,
unavailable, stale, timed-out, and failed reads have `null` values: they never draw a graph or reuse
an old value. History inserts an explicit gap so a later sample cannot draw through an outage.

When **Hide unavailable graphs** is off, an unavailable metric remains as a text-only card. When the
option is on, that entire card container is omitted. The option supports controlled state so an
adopting settings owner can persist it; this slice does not invent another settings store.

CPU temperature, RAM temperature, GPU utilization or temperature, disk usage or temperature, fan
speed, and RGB state are not claimed by this UI. Project-volume telemetry is also deferred until a
bounded platform probe exists.

## Bounded polling contract

The panel receives its client by injection and admits at most one read at a time. Each read carries
an `AbortSignal`; project changes, disabled polling, and unmount abort the active read. A client that
ignores cancellation cannot cause overlapping reads: retry waits for its pending promise to settle,
and any late result is discarded.

The default interval is three seconds and respects a longer server-provided minimum interval.
Requests time out after ten seconds, errors back off to at least ten seconds, and a local freshness
deadline removes old values. Timer inputs are finite, bounded, and never scheduled below 250 ms.
History defaults to 48 samples and is capped at 120 samples.

Raw transport errors are never rendered. The optional failure callback receives only a bounded
error-name code.

## Deferred adoption

Mounting this panel requires all of the following in a later PR:

- an authenticated endpoint scoped to the requested project and the current operator;
- decoded response contracts and cancellation wired to the injected client;
- visibility-aware polling ownership; and
- persistence for the controlled **Hide unavailable graphs** preference.

Until those boundaries are reviewed, this component remains an importable, testable presentation
slice rather than live application behavior.
