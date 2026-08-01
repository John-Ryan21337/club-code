# Host system telemetry foundation

Status: bounded contracts/server sampler slice. This is not the Project Resources graph UI,
project-volume probe, GPU sampler, RGB integration, or unavailable-chart follow-up.

## Truthful availability

This slice reports only measurements exposed by the Node runtime:

- aggregate host CPU utilization, after a second monotonic counter sample;
- logical processor count; and
- process-effective total, available, used, and utilization memory where the platform exposes a
  trustworthy available-memory counter.

Unavailable and warming metrics carry `null` measurements. They never masquerade as measured
zeroes. Counter exceptions are mapped to fixed privacy-safe details rather than leaking host paths,
commands, or exception text.

CPU temperature, RAM temperature, GPU load/temperature, storage temperature, fan speed, RGB state,
and per-project volume usage are intentionally not sampled here. A later adapter may expose a metric
only when it has a measured value from a bounded platform source; unsupported sensors must remain
unavailable and the UI must be free to omit their graphs.

## Sampling boundary

CPU usage is derived from aggregate counter deltas and never from a fabricated instantaneous value.
The first sample warms a baseline. Reads inside the one-second minimum interval reuse the last CPU
result, topology/platform changes reset the baseline, invalid or stalled counters fail closed, and a
transient read failure does not destroy the last healthy baseline.

Memory uses the process-effective constraint when Node reports one. Unconstrained macOS memory
fails closed because raw Mach free pages omit reusable inactive, purgeable, and cache pages and can
make a healthy machine appear exhausted.

## Deferred integration

This slice opens no endpoint and adds no renderer polling. Project selection, bounded service-level
caching, RPC authorization, project-volume probes, GPU/platform adapters, and measured-only graph
rendering belong in separately reviewed adoption PRs.
