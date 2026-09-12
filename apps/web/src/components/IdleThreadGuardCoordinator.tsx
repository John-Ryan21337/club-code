import { useEffect, useMemo, useRef, useState } from "react";
import { readEnvironmentApi } from "../environmentApi";
import {
  beginIdleThreadGuardRequest,
  claimIdleThreadGuardRequest,
  isIdleThreadGuardDue,
  latestIdleActivityAt,
  settleIdleThreadGuardRequest,
  type IdleThreadGuardConfig,
  useIdleThreadGuardState,
} from "../idleThreadGuard";
import { newCommandId, newMessageId } from "../lib/utils";
import { useStore } from "../store";
import { createFollowUpQueuePersistence } from "./chat/followUpQueuePersistence";

const RECONCILIATION_INTERVAL_MS = 60_000;

function activeGuardActivity(
  environments: ReturnType<typeof useStore.getState>["environmentStateById"],
  config: IdleThreadGuardConfig,
): string | null {
  const environment = environments[config.environmentId];
  if (!environment?.bootstrapComplete) return null;
  const shell = environment.threadShellById[config.threadId];
  const summary = environment.sidebarThreadSummaryById[config.threadId];
  const session = environment.threadSessionById[config.threadId] ?? summary?.session ?? null;
  const latestTurn =
    environment.threadTurnStateById[config.threadId]?.latestTurn ?? summary?.latestTurn ?? null;
  if (
    !shell ||
    !summary ||
    !session ||
    shell.archivedAt !== null ||
    Boolean(shell.error) ||
    summary.hasPendingApprovals ||
    summary.hasPendingUserInput ||
    summary.hasActionableProposedPlan ||
    session.status !== "running" ||
    !session.activeTurnId ||
    latestTurn?.state !== "running"
  )
    return null;
  return latestIdleActivityAt([
    shell.updatedAt,
    summary.updatedAt,
    session.updatedAt,
    latestTurn.startedAt,
    latestTurn.requestedAt,
  ]);
}

export function IdleThreadGuardCoordinator() {
  const environmentStateById = useStore((store) => store.environmentStateById);
  const guardState = useIdleThreadGuardState();
  const queuePersistence = useMemo(() => createFollowUpQueuePersistence(), []);
  const [clockRevision, setClockRevision] = useState(0);
  const inFlightScopesRef = useRef(new Set<string>());
  const mountedRef = useRef(false);
  const hasEnabledGuard = Object.values(guardState.configs).some((config) => config.enabled);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hasEnabledGuard) return;
    const timer = window.setInterval(
      () => setClockRevision((current) => current + 1),
      RECONCILIATION_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [hasEnabledGuard]);

  useEffect(() => {
    for (const [scopeKey, config] of Object.entries(guardState.configs)) {
      if (
        !config.enabled ||
        config.awaitingAcknowledgement ||
        inFlightScopesRef.current.has(scopeKey)
      )
        continue;
      const activity = activeGuardActivity(environmentStateById, config);
      if (!activity) continue;
      if (config.awaitingActivityAfterDispatchAt !== null) {
        if (Date.parse(activity) <= Date.parse(config.awaitingActivityAfterDispatchAt)) continue;
      } else if (
        !isIdleThreadGuardDue({
          nowMs: Date.now(),
          latestActivityAt: activity,
          armedAt: config.armedAt,
          idleHours: config.idleHours,
        })
      )
        continue;

      inFlightScopesRef.current.add(scopeKey);
      void claimIdleThreadGuardRequest(config, (current) => {
        // Recheck the current exact thread after acquiring the cross-renderer state lock.
        const latestActivity = activeGuardActivity(
          useStore.getState().environmentStateById,
          current,
        );
        if (!latestActivity || !readEnvironmentApi(current.environmentId)) return null;
        // Cafe owns follow-ups in its renderer queue, not a Club-only shell counter.
        const queue = queuePersistence.hasForThread(current);
        return queue.ok && !queue.value ? latestActivity : null;
      })
        .then(async (claim) => {
          if (!claim) return;
          try {
            const started = await beginIdleThreadGuardRequest(
              claim.config,
              claim.requestId,
              (current) => {
                if (!mountedRef.current) return false;
                const activity = activeGuardActivity(
                  useStore.getState().environmentStateById,
                  current,
                );
                const queue = queuePersistence.hasForThread(current);
                return (
                  activity !== null &&
                  queue.ok &&
                  !queue.value &&
                  isIdleThreadGuardDue({
                    nowMs: Date.now(),
                    latestActivityAt: activity,
                    armedAt: current.armedAt,
                    idleHours: current.idleHours,
                  })
                );
              },
              (current) => {
                const api = readEnvironmentApi(current.environmentId);
                if (!api) throw new Error("Guard environment is unavailable");
                return api.orchestration.dispatchCommand({
                  type: "thread.turn.steer",
                  commandId: newCommandId(),
                  threadId: current.threadId,
                  message: {
                    messageId: newMessageId(),
                    role: "user",
                    text: current.prompt,
                    attachments: [],
                  },
                  createdAt: claim.dispatchedAt,
                });
              },
            );
            if (!started) return;
            await started.completion;
            await settleIdleThreadGuardRequest(
              claim.config,
              claim.requestId,
              claim.dispatchedAt,
              new Date().toISOString(),
            );
          } catch {
            await settleIdleThreadGuardRequest(
              claim.config,
              claim.requestId,
              claim.dispatchedAt,
              null,
            );
          }
        })
        .finally(() => {
          inFlightScopesRef.current.delete(scopeKey);
        });
    }
  }, [clockRevision, environmentStateById, guardState, queuePersistence]);
  return null;
}
