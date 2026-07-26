import type {
  EnvironmentId,
  OrchestrationSessionStatus,
  ServerProvider,
  ThreadId,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { PacingActiveWorkLease } from "../boundedPacingAdmission.ts";
import {
  ProviderPacingActiveTurnLifecycle,
  type ProviderPacingAcceptedLaunchInput,
  type ProviderPacingActiveTurnLifecycleShape,
} from "../Services/ProviderPacingActiveTurnLifecycle.ts";
import {
  ProviderPacingAdmission,
  type ProviderPacingAdmissionShape,
} from "../Services/ProviderPacingAdmission.ts";

interface ActiveTurnLease {
  readonly provider: ServerProvider;
  readonly lease: PacingActiveWorkLease;
}

function sessionIdentity(environmentId: EnvironmentId, threadId: ThreadId): string {
  return JSON.stringify([String(environmentId), String(threadId)]);
}

function activeWorkIdentity(environmentId: EnvironmentId, threadId: ThreadId): string {
  return JSON.stringify(["orchestration-thread", String(environmentId), String(threadId)]);
}

function isProjectedActive(status: OrchestrationSessionStatus): boolean {
  return status === "starting" || status === "running";
}

/**
 * Keeps provider admission accounting alive for the entire projected turn,
 * rather than only for the short provider `sendTurn` acknowledgement.
 *
 * The registry deliberately stores only accounting leases. Releasing or
 * disposing one cannot interrupt, cancel, signal, or otherwise reach provider
 * work; provider lifecycle remains exclusively owned by ProviderService.
 */
export function makeProviderPacingActiveTurnLifecycle(
  admission: ProviderPacingAdmissionShape,
): ProviderPacingActiveTurnLifecycleShape {
  const projectedStatuses = new Map<string, OrchestrationSessionStatus>();
  const activeLeases = new Map<string, ActiveTurnLease>();
  let disposed = false;

  const releaseIdentity = (identity: string): boolean => {
    const active = activeLeases.get(identity);
    if (active === undefined) return false;
    activeLeases.delete(identity);
    active.lease.release();
    return true;
  };

  const adopt = (input: ProviderPacingAcceptedLaunchInput): boolean => {
    if (disposed) return false;
    const identity = sessionIdentity(input.environmentId, input.threadId);
    if (activeLeases.has(identity)) return false;

    const lease = admission.adoptActiveWork({
      environmentId: input.environmentId,
      provider: input.provider,
      activeWorkIdentity: activeWorkIdentity(input.environmentId, input.threadId),
    });
    activeLeases.set(identity, { provider: input.provider, lease });
    return true;
  };

  return {
    noteProjectedSession: (input) => {
      if (disposed) return;
      const identity = sessionIdentity(input.environmentId, input.threadId);
      projectedStatuses.set(identity, input.status);
      if (!isProjectedActive(input.status)) releaseIdentity(identity);
    },
    adoptAcceptedLaunch: (input) => {
      if (disposed) return false;
      const identity = sessionIdentity(input.environmentId, input.threadId);
      const projectedStatus = projectedStatuses.get(identity);

      // A very short turn may become terminal before its provider ACK reaches
      // the command reactor. The launch admission itself accounted for that
      // interval, so creating a lease after terminal truth would leak pacing
      // capacity forever.
      if (projectedStatus !== undefined && !isProjectedActive(projectedStatus)) {
        return false;
      }
      return adopt(input);
    },
    adoptObservedRunning: (input) => {
      if (disposed) return false;
      const identity = sessionIdentity(input.environmentId, input.threadId);
      projectedStatuses.set(identity, "running");
      return adopt(input);
    },
    forgetThread: (environmentId, threadId) => {
      const identity = sessionIdentity(environmentId, threadId);
      projectedStatuses.delete(identity);
      return releaseIdentity(identity);
    },
    getCounts: () => ({
      trackedSessions: projectedStatuses.size,
      activeLeases: activeLeases.size,
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const identity of activeLeases.keys()) releaseIdentity(identity);
      projectedStatuses.clear();
    },
  };
}

export const ProviderPacingActiveTurnLifecycleLive = Layer.effect(
  ProviderPacingActiveTurnLifecycle,
  Effect.gen(function* () {
    const admission = yield* ProviderPacingAdmission;
    return yield* Effect.acquireRelease(
      Effect.sync(() => makeProviderPacingActiveTurnLifecycle(admission)),
      (lifecycle) => Effect.sync(() => lifecycle.dispose()),
    );
  }),
);
