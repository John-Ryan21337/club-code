# Ambient image maintenance

Bounded startup recovery of ambient image bytes that the client settings
document no longer references.

The parent slice (`docs/ambient-images.md`) shipped upload, storage, serving and
renderer-driven pruning. Pruning only runs while a renderer is alive to run it,
so an interrupted upload or a folder replacement that dies mid-flight can leave
bytes in the profile that nothing points at. Those bytes still occupy the
256-asset / 160 MiB profile quota, and once the quota is full, uploads are
refused. This slice adds the recovery pass and nothing else. There is no user
interface for it.

## What runs, and when

One pass per server start, before the server can serve anything.

1. `withAmbientImageMaintenanceGate` wraps the whole server application layer.
2. The gate starts the client settings runtime and waits for it, bounded.
3. The gate takes the settings write permit and hands the sweep a reference set
   that cannot change underneath it.
4. The sweep deletes at most 32 aged, unreferenced, store-minted files.
5. Only then does the application layer exist, so only then can the HTTP router,
   its WebSocket RPC route and the HTTPS sibling listener be installed.

## Why the ordering is a data dependency

The reference source has to be still while the decision is made. Two fresh
reads around a delete do not achieve that: a settings write that lands between
the second read and the unlink still loses its bytes. Two mechanisms are used
together, and both are load-bearing.

**Order.** `withAmbientImageMaintenanceGate` is built on `Layer.unwrap`. The
application layer value is produced by the maintenance effect, so it does not
exist until maintenance has returned. This is not a merge ordering that a later
refactor could silently reorder, and it does not depend on `Layer.provide`
building an output nobody consumes.

```
makeServerLayer
  └── withAmbientImageMaintenanceGate(serverApplicationLayer)   <- maintenance runs here
        ├── HttpRouter.serve(makeRoutesLayer)                   <- all HTTP + WS routes
        ├── httpListeningLayer                                  <- markHttpListening
        ├── httpsSiblingLayer                                   <- HTTPS sibling routes
        └── runtimeStateLayer
      provided by: RuntimeServicesLive, AmbientImageStoreLive, ...
```

**Lock.** The decision runs inside `ServerClientSettings.withReferenceLock`,
which takes the same single write permit as `updateSettings` and as the settings
file watcher's revalidation. Order alone would still race the file watcher,
which can fire at any time and is not gated by anything in the layer graph.

`ServerRuntimeStartup` forks its startup phases, so placing the sweep inside one
of them would **not** have ordered it ahead of the router. That is why this
slice does not reuse the upstream placement. See "Divergence from upstream".

### No startup cycle

The gate calls `ServerClientSettings.start` itself rather than waiting for
`ServerRuntimeStartup` to have forked it. `start` is idempotent: the first
caller loads the document and later callers await the same deferred. So the gate
depends on `ServerClientSettingsService` and `AmbientImageStore` only, and
nothing in `RuntimeServicesLive` depends on the gate.

## Lock order

Settings write permit first, then the ambient image store's mutation permit.

| Path                                  | Settings permit | Store permit |
| ------------------------------------- | --------------- | ------------ |
| `updateSettings` (RPC, WebSocket)     | yes             | no           |
| settings file watcher revalidation    | yes             | no           |
| `POST /api/ambient-media/image`       | no              | yes          |
| `DELETE /api/ambient-media/image/:id` | yes             | then yes     |
| startup maintenance                   | yes             | then yes     |

Nothing takes them the other way round, so there is no cycle. Callers inside
`withReferenceLock` must never call `updateSettings` or `withReferenceLock`; the
permit is not reentrant.

## What is deleted, and what is never deleted

A file is deleted only if every one of these holds:

- its name matches the minted id pattern
  `sha256-<64 hex>.{gif,jpg,jpeg,png,webp}`;
- `lstat` reports a plain file — not a symbolic link, not a Windows junction,
  not a directory, not a device;
- it has a usable modification time that is not in the future;
- it is at least 24 hours old;
- the locked settings snapshot does not reference it, as either the selected
  `ambientImageAsset` or a member of `ambientImageCycleAssets`;
- the run has not yet attempted 32 deletions.

Everything else is retained and counted. In particular:

- **Foreign and invalid files are preserved.** Anything the store did not mint
  keeps its name and its bytes.
- **Links are never followed.** Effect's portable `FileSystem` has no `lstat`
  and its `stat` follows links, so the sweep calls `node:fs/promises.lstat`
  directly. Reading a link's target would age a foreign file against the grace
  period and count quota that was never occupied.
- **Missing or unusable modification times are not evidence of age**, so they
  are not evidence of an orphan either.
- **Pending uploads are safe by construction.** An upload writes bytes before
  the renderer can save the settings document that references them, and a folder
  replacement writes a whole cycle before one settings write adopts it. The
  24-hour grace period is what makes that window safe; it is not a tuning knob.
- **User configuration is never touched.** Maintenance reads the settings
  document and never writes it.

## Bounds

| Bound                          | Value    | Constant                                     |
| ------------------------------ | -------- | -------------------------------------------- |
| Grace period                   | 24 hours | `AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS`       |
| Owned-asset candidates per run | 256      | `AMBIENT_IMAGE_SWEEP_MAX_CANDIDATES`         |
| Deletions per run              | 32       | `AMBIENT_IMAGE_SWEEP_MAX_DELETIONS`          |
| Wait for settings readiness    | 10 s     | `AMBIENT_IMAGE_MAINTENANCE_SETTINGS_TIMEOUT` |
| Wait for the sweep             | 15 s     | `AMBIENT_IMAGE_MAINTENANCE_SWEEP_TIMEOUT`    |

A caller may ask for _less_ work than the compiled bounds allow, never more; a
missing or nonsensical bound falls back to the maximum rather than to
"unbounded". Recovery is deliberately incremental: a profile holding hundreds of
orphans is cleared over several restarts.

## Failure policy

The startup-readiness deadline bounds only the maintenance wait. Shared settings startup stays owned by the server scope and continues after this wait expires; the maintenance waiter does not cancel or poison it. Other application services can still depend on that startup completing. Maintenance logs contain fixed reasons and counts, without raw filesystem or settings errors.

Directory enumeration reads at most 512 entries, including foreign names, using a bounded directory iterator. It closes the directory handle before processing the bounded list. A larger directory reports `scan-limit`; foreign entries are retained and can delay discovery of later owned files. No run sorts or materializes the whole directory. The deletion limit counts attempted unlinks, including failures.

Every failure mode retains bytes. There is no path from a failed read to a
deletion.

| Failure                                        | Result                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings runtime fails to start                | Sweep is skipped. Nothing is deleted. Server starts.                                                                                                      |
| Settings runtime does not become ready in 10 s | Sweep is skipped. Nothing is deleted. Shared settings startup continues; the maintenance gate releases.                                                   |
| Profile directory cannot be listed             | No-op run. Server starts.                                                                                                                                 |
| One entry cannot be probed                     | That entry is retained, counted in `retained.failed`, and the run continues.                                                                              |
| One unlink fails                               | Same. The remaining assets are untouched.                                                                                                                 |
| Sweep does not finish in 15 s                  | Startup stops waiting and the server starts. The sweep keeps the settings write permit, so ambient image reference writes stay blocked until it finishes. |

That last row is the shape the requirement asks for from both sides. A wedged
filesystem must not hold the whole server hostage, and it must also not let
reference mutations resume underneath a destructive operation that is still
running. Startup gives up _waiting_; it does not give up the lock, and it does
not cancel or abandon the work.

The sweep fiber is forked into the layer scope, not fire-and-forget. Server
shutdown interrupts it. Its unlink step is `Effect.uninterruptible`, so an
interrupt is observed between deletions rather than during one, and the lock is
not released while a syscall is still in flight.

## The DELETE route guard

`DELETE /api/ambient-media/image/:id` previously read the settings document and
then removed the file — a snapshot check, not an atomic one. A settings write
that adopted the id between the read and the unlink would leave the document
pointing at bytes that had been verified unreferenced and deleted anyway.

That check and the unlink are now one critical section under the same reference
lock. A concurrent settings write either lands strictly before the check, in
which case the request is refused with `409 referenced`, or strictly after the
unlink, in which case the id was already gone when the client adopted it — the
same outcome as adopting an id that never existed, which the client handles as
a `404` from the serve route.

## Known limits

- **A hostile local process can still win a TOCTOU race.** Between `lstat` and
  `unlink` the entry could be replaced. The damage is bounded: replacing it with
  a link means the link is unlinked and its target survives, and replacing it
  with a directory means the unlink fails and is counted. Closing the race
  properly needs `openat`/`unlinkat` with `O_NOFOLLOW` against a directory
  descriptor, which Node does not expose portably. The profile directory lives
  inside the user's own state directory, so a process that can plant entries
  there already has write access to it.
- **A syscall that never returns is not recoverable here.** The 15-second bound
  stops startup from waiting, and the count bounds stop the run from starting
  more work, but an `unlink` that hangs forever holds the settings write permit
  forever. Node exposes no way to cancel an in-flight filesystem syscall.
- **Recovery is not immediate.** Bytes from a crashed upload become reclaimable
  24 hours later, and at most 32 files per restart.
- **The sweep does not reconcile the settings document.** If the document
  references an id whose bytes are already gone, maintenance leaves the document
  alone; the renderer sees a `404` from the serve route.

## Divergence from upstream

Upstream Club Code has a `sweepUnreferencedImages` on the same store, called
from a `ServerRuntimeStartup` phase. Two differences matter:

1. **Placement.** The upstream caller runs inside the startup body, which
   `ServerRuntimeStartup` forks. The layer build returns as soon as the fork is
   scheduled, so the sweep is not ordered ahead of `HttpRouter.serve`. Its
   documented requirement that the reference source be quiescent is not
   established by its caller.
2. **Reference reads.** Upstream re-reads the settings document twice around
   each deletion and treats a read failure as "referenced". Fresh reads are not
   atomic against a write that lands after the second one. Here the store takes
   a `ReadonlySet<string>` and cannot read settings at all, so there is no way
   to run it against a reference set the caller is not holding still.

The upstream default-image seeding phase is not ported.

## Tested behavior

`apps/server/src/ambientMedia/AmbientImageStore.test.ts` (7 maintenance tests,
real temporary directories and real modification times):

- quota recovery observed on storage — an aged unreferenced file is removed, the
  directory's byte total drops by exactly its size, and a referenced file, a
  fresh file and a foreign name all survive;
- the 24-hour boundary holds on both sides;
- a symbolic link planted under a minted name is not followed and its target
  survives (the link-specific assertion is skipped where the platform refuses to
  create symlinks without privilege);
- the 32-deletion bound stops a run and the next run resumes from where it
  stopped;
- a caller asking for more than the compiled bounds is clamped down;
- an entry that cannot be unlinked is counted while every other asset is still
  processed, and nothing escalates to a blanket deletion;
- an unlistable profile directory produces a no-op result.

`apps/server/src/serverClientSettings.test.ts`: a settings write is held for the
entire duration of an open reference lock, then applied.

`apps/server/src/server.test.ts` (3 tests, through the real gate composition):

- an aged orphan planted before startup is already `404` on the first request a
  client can make, while the referenced image serves `200` and a fresh orphan
  survives;
- a settings runtime that fails to start leaves every byte in place and does not
  block the server;
- the delete guard answers from the locked document even when a loose snapshot
  read disagrees.

Every other test in `server.test.ts` also builds through
`withAmbientImageMaintenanceGate`, so the composition is exercised by the whole
suite rather than by one bespoke assembly.

## Files

| File                                                      | Change                                             |
| --------------------------------------------------------- | -------------------------------------------------- |
| `apps/server/src/ambientMedia/AmbientImageStore.ts`       | `sweepUnreferencedImages`, bounds, link-safe probe |
| `apps/server/src/ambientMedia/AmbientImageMaintenance.ts` | new: the gate, the report, the reference-id helper |
| `apps/server/src/ambientMedia/http.ts`                    | DELETE guard moved under the reference lock        |
| `apps/server/src/serverClientSettings.ts`                 | `withReferenceLock` on the real and test layers    |
| `apps/server/src/server.ts`                               | gate applied to the server application layer       |
