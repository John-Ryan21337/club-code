# Host GPU telemetry

Expand **Resources** in a project chat to view GPU utilization and VRAM use for the selected environment's host. GPU utilization is the highest measured adapter value. VRAM use combines the adapters. These are host measurements, not the selected project's resource use.

This slice adds NVIDIA measurements to the existing CPU, RAM, storage, and graph prerequisites. Older remote backends can omit `gpu`; the graph continues to show **Unavailable**. AMD, Intel, and Apple GPU readers are outside this slice. Temperature values from NVIDIA are retained in the response when available; a temperature display and other sensor sources are separate follow-ups. Network throughput is also separate.

## Sources and bounds

The reader uses the fixed [NVIDIA query format](https://docs.nvidia.com/deploy/nvidia-smi/) with name, index, utilization, memory, and temperature fields. It runs only from the platform's allowed system locations. It does not search PATH, accept renderer command arguments, install drivers, or ask for elevated access. Windows-specific path and environment rules are in `AGENTS.md`.

One host sampler serves all project requests. It coalesces reads and caches successes and failures for three seconds. Each helper has a two-second deadline, a 500 ms forced-settlement grace, a 16 KiB output limit, and a single active slot. At most two unreaped helpers can remain; a second unreaped failure closes admission until one exits. Owner shutdown settles within its bounded grace. An operating-system process that cannot be killed can outlive that grace; its handle cannot retain the server process.

Only validated adapter fields cross the existing authenticated telemetry RPC. A malformed core field rejects the complete adapter list. An unreadable optional temperature is omitted while valid utilization and memory values remain available. Raw stderr, executable paths, and exception details are discarded. A GPU failure does not remove CPU, memory, or selected-project storage measurements. No network request, account credential, packet content, or user file is needed by this reader.

## Adoption history

The prerequisite branch `adoption/telemetry-foundations-20260911` restacks the unique commits from Cafe drafts #15, #37–#40, and #42–#46 onto `dev` commit `99fbaec89da429924171c89d66a8f3455e42d9b0`. It retains current provider interactions, dictation, subagent detail, and chat history behavior when resolving old mount points. Those drafts remain open; this branch is a current integration base and does not claim that they are merged.

This GPU implementation comes from Club Code commit `886feafc`, with an optional transport field for older remote servers, current Cafe aggregation, and the physical-host check moved to the existing opt-in integration suite. The existing CPU, memory, and storage contract checks remain intact. Track follow-up adapters in [Cafe issue #82](https://github.com/cafeai/cafe-code/issues/82).

## Verification

These images use synthetic responses in the same existing graph. They show an older backend with no GPU field, then a measured response. They are not measurements from the test machine.

| Before                                                             | After                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| ![GPU fields unavailable](pr-assets/host-gpu-telemetry/before.png) | ![GPU and VRAM measurements](pr-assets/host-gpu-telemetry/after.png) |

Default tests cover malformed and oversized output, fixed commands and environment, unsupported platforms, child errors, deadlines, bounded recovery, shutdown, host caching, contract bounds, authenticated RPC serialization, and visible GPU/VRAM values. They use synthetic outputs, fake children, or an isolated Node fixture. They do not query physical GPUs.

To check the selected machine explicitly, run:

```sh
yarn workspace @cafeai/cafe-code exec vitest run --config vitest.e2e.config.ts integration/GpuTelemetry.e2e.test.ts
```

An unavailable result is valid on unsupported hardware. This command checks the actual response contract; it does not certify every vendor, driver, operating system, or physical measurement.
