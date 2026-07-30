import { useEffect, useRef, useState } from "react";

import { readEnvironmentApi } from "../environmentApi";
import {
  IDLE_THREAD_GUARD_MIN_HOURS,
  isIdleThreadGuardDue,
  latestIdleActivityAt,
  patchIdleThreadGuardConfig,
  useIdleThreadGuardState,
} from "../idleThreadGuard";
import { newCommandId, newMessageId } from "../lib/utils";
import { useStore } from "../store";

const RECONCILIATION_INTERVAL_MS = 60_000;

export function IdleThreadGuardCoordinator() {
  const environmentStateById = useStore((store) => store.environmentStateById);
  const guardState = useIdleThreadGuardState();
  const [clockRevision, setClockRevision] = useState(0);
  const inFlightScopesRef = useRef(new Set<string>());

  useEffect(() => {
    const timer = window.setInterval(
      () => setClockRevision((current) => current + 1),
      RECONCILIATION_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nowMs = Date.now();
    for (const [scopeKey, config] of Object.entries(guardState.configs)) {
      if (!config.enabled || inFlightScopesRef.current.has(scopeKey)) continue;
      const environment = environmentStateById[config.environmentId];
      if (!environment?.bootstrapComplete) continue;
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
        shell.manualFollowUpCount > 0 ||
        summary.hasPendingApprovals ||
        summary.hasPendingUserInput ||
        summary.hasActionableProposedPlan ||
        session.status !== "running" ||
        !session.activeTurnId ||
        latestTurn?.state !== "running"
      ) {
        continue;
      }

      const latestActivityAt = latestIdleActivityAt([
        shell.updatedAt,
        summary.updatedAt,
        session.updatedAt,
        latestTurn.startedAt,
        latestTurn.requestedAt,
      ]);
      if (!latestActivityAt) continue;

      const waitingSince = config.awaitingActivityAfterDispatchAt;
      if (waitingSince !== null) {
        if (Date.parse(latestActivityAt) > Date.parse(waitingSince)) {
          patchIdleThreadGuardConfig(config, {
            awaitingActivityAfterDispatchAt: null,
            armedAt: latestActivityAt,
            lastError: null,
          });
        }
        continue;
      }

      if (
        !isIdleThreadGuardDue({
          nowMs,
          latestActivityAt,
          armedAt: config.armedAt,
          idleHours: Math.max(IDLE_THREAD_GUARD_MIN_HOURS, config.idleHours),
        })
      ) {
        continue;
      }

      const api = readEnvironmentApi(config.environmentId);
      if (!api) continue;
      const dispatchedAt = new Date().toISOString();
      inFlightScopesRef.current.add(scopeKey);
      // Persist the one-shot barrier before crossing the transport boundary.
      // A crash or indeterminate response therefore fails closed.
      patchIdleThreadGuardConfig(config, {
        awaitingActivityAfterDispatchAt: dispatchedAt,
        lastError: null,
      });
      void api.orchestration
        .dispatchCommand({
          type: "thread.turn.steer",
          commandId: newCommandId(),
          threadId: config.threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: config.prompt,
            attachments: [],
          },
          dispatchSource: "user",
          createdAt: dispatchedAt,
        })
        .catch(() => {
          patchIdleThreadGuardConfig(config, {
            lastError:
              "The status request was not acknowledged. The Guard is paused fail-closed until new activity or an explicit resave.",
          });
        })
        .finally(() => {
          inFlightScopesRef.current.delete(scopeKey);
        });
    }
  }, [clockRevision, environmentStateById, guardState]);

  return null;
}
