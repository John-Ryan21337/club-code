import {
  defaultInstanceIdForDriver,
  type ServerProvider,
  type ThreadAutoNudgeSummary,
} from "@cafecode/contracts";
import { useEffect, useRef, useState } from "react";

import { AUTO_NUDGE_DELAY_MS, getAutoNudgeTurnLedger } from "../autoNudger";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  getConfirmedAutoNudgeArming,
  useAutoNudgeSuppressedState,
} from "../confirmedAutoNudgeArming";
import { readEnvironmentApi } from "../environmentApi";
import {
  getSavedEnvironmentRuntimeState,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { readPrimaryEnvironmentDescriptor } from "../environments/primary";
import { newCommandId, newMessageId } from "../lib/utils";
import { useServerConfig } from "../rpc/serverState";
import { useStore } from "../store";
import type { ThreadShell } from "../types";

const COORDINATOR_TICK_MS = 250;

function providerCanAcceptTurn(provider: ServerProvider | null): boolean {
  if (
    !provider ||
    provider.status !== "ready" ||
    !provider.enabled ||
    !provider.installed ||
    provider.availability === "unavailable" ||
    provider.auth.status !== "authenticated"
  ) {
    return false;
  }
  const limits = provider.accountRateLimits?.rateLimits;
  if (!limits) return true;
  if (limits.rateLimitReachedType || limits.spendControlReached) return false;
  return (limits.primary?.usedPercent ?? 0) < 100 && (limits.secondary?.usedPercent ?? 0) < 100;
}

function authorityKey(
  shell: ThreadShell,
  config: ThreadAutoNudgeSummary,
  completedTurnId: string,
): string {
  return `${shell.environmentId}:${shell.id}:${completedTurnId}:${config.authorityRevision}`;
}

function stopKey(shell: ThreadShell, config: ThreadAutoNudgeSummary): string {
  return `${shell.environmentId}:${shell.id}:${config.authorityRevision}`;
}

/**
 * Schedules every independently opted-in thread from prompt-free shell state.
 *
 * The renderer is only a timer. The exact environment server rechecks the
 * thread, authority revision, terminal turn, caps, and background permission,
 * then reads that thread's persisted prompt. Concurrent renderers may race,
 * but only one serialized command can consume a terminal turn.
 */
export function BackgroundAutoNudgeCoordinator() {
  const globallySuppressed = useAutoNudgeSuppressedState();
  const serverConfig = useServerConfig();
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);
  const environmentStateById = useStore((store) => store.environmentStateById);
  const [tick, setTick] = useState(0);
  const eligibleSinceByAuthorityRef = useRef(new Map<string, number>());
  const attemptedAuthoritiesRef = useRef(new Set<string>());
  const stopRequestsRef = useRef(new Set<string>());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, COORDINATOR_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nowMs = Date.now();
    const observedAuthorityKeys = new Set<string>();
    const liveAuthorityKeys = new Set<string>();
    const liveStopKeys = new Set<string>();

    for (const environment of Object.values(environmentStateById)) {
      if (!environment.bootstrapComplete) continue;

      for (const threadId of environment.threadIds) {
        const shell = environment.threadShellById[threadId];
        if (!shell) continue;
        const config = shell.autoNudge;

        if (globallySuppressed) {
          if (config.mode === "off") continue;
          const requestKey = stopKey(shell, config);
          liveStopKeys.add(requestKey);
          if (stopRequestsRef.current.has(requestKey)) continue;
          const api = readEnvironmentApi(shell.environmentId);
          if (!api) continue;
          stopRequestsRef.current.add(requestKey);
          void api.orchestration
            .dispatchCommand({
              type: "thread.auto-nudge.stop",
              commandId: newCommandId(),
              threadId: shell.id,
              createdAt: new Date().toISOString(),
            })
            .catch(() => {
              stopRequestsRef.current.delete(requestKey);
            });
          continue;
        }

        if (
          config.mode === "off" ||
          !config.backgroundContinuation ||
          shell.archivedAt !== null ||
          config.roundsDispatched >= config.maxRounds ||
          config.armedAt === null
        ) {
          continue;
        }

        const armedAtMs = Date.parse(config.armedAt);
        if (!Number.isFinite(armedAtMs) || nowMs - armedAtMs >= config.maxMinutes * 60_000) {
          continue;
        }

        const summary = environment.sidebarThreadSummaryById[threadId];
        const session = environment.threadSessionById[threadId] ?? summary?.session ?? null;
        const latestTurn =
          environment.threadTurnStateById[threadId]?.latestTurn ?? summary?.latestTurn ?? null;
        if (
          !summary ||
          !session ||
          session.status !== "ready" ||
          latestTurn?.state !== "completed" ||
          !latestTurn.completedAt ||
          latestTurn.turnId === config.baselineSettledTurnId ||
          latestTurn.turnId === config.lastDispatchedSettledTurnId
        ) {
          continue;
        }

        const key = authorityKey(shell, config, latestTurn.turnId);
        liveAuthorityKeys.add(key);
        const draft = useComposerDraftStore.getState().getComposerDraft({
          environmentId: shell.environmentId,
          threadId: shell.id,
        });
        if (
          summary.hasPendingApprovals ||
          summary.hasPendingUserInput ||
          summary.hasActionableProposedPlan ||
          Boolean(draft?.prompt.trim()) ||
          (draft?.images.length ?? 0) > 0 ||
          Boolean(shell.error)
        ) {
          continue;
        }

        const providerInstanceId =
          session.providerInstanceId ??
          (session.provider
            ? defaultInstanceIdForDriver(session.provider)
            : shell.modelSelection.instanceId);
        const environmentServerConfig =
          shell.environmentId === readPrimaryEnvironmentDescriptor()?.environmentId
            ? serverConfig
            : getSavedEnvironmentRuntimeState(shell.environmentId).serverConfig;
        const provider =
          environmentServerConfig?.providers.find(
            (entry) => entry.instanceId === providerInstanceId,
          ) ?? null;
        if (!providerCanAcceptTurn(provider)) continue;

        observedAuthorityKeys.add(key);
        if (getAutoNudgeTurnLedger().has(key)) {
          continue;
        }

        const eligibleSince = eligibleSinceByAuthorityRef.current.get(key);
        if (eligibleSince === undefined) {
          eligibleSinceByAuthorityRef.current.set(key, nowMs);
          continue;
        }
        if (
          nowMs - eligibleSince < AUTO_NUDGE_DELAY_MS ||
          attemptedAuthoritiesRef.current.has(key)
        ) {
          continue;
        }

        const api = readEnvironmentApi(shell.environmentId);
        if (!api) continue;

        const arming = getConfirmedAutoNudgeArming();
        arming.synchronizeSuppressionFromStorage();
        if (!arming.confirmExecutionAuthorized()) continue;

        // Consume locally before transport and never retry an uncertain result.
        // Server-side revision/terminal checks remain the actual authority.
        attemptedAuthoritiesRef.current.add(key);
        if (!arming.confirmExecutionAuthorized()) continue;
        getAutoNudgeTurnLedger().mark(key);

        void api.orchestration
          .dispatchCommand({
            type: "thread.auto-nudge.dispatch",
            commandId: newCommandId(),
            threadId: shell.id,
            expectedAuthorityRevision: config.authorityRevision,
            completedTurnId: latestTurn.turnId,
            dispatchSource: "background",
            messageId: newMessageId(),
            createdAt: new Date().toISOString(),
          })
          .catch(() => {
            // Fail closed. A new projection revision or terminal turn creates a
            // different key and is the only condition that permits another try.
          });
      }
    }

    for (const key of eligibleSinceByAuthorityRef.current.keys()) {
      if (!observedAuthorityKeys.has(key)) {
        eligibleSinceByAuthorityRef.current.delete(key);
      }
    }
    for (const key of attemptedAuthoritiesRef.current) {
      if (!liveAuthorityKeys.has(key)) {
        attemptedAuthoritiesRef.current.delete(key);
      }
    }
    for (const key of stopRequestsRef.current) {
      if (!liveStopKeys.has(key)) {
        stopRequestsRef.current.delete(key);
      }
    }
  }, [environmentStateById, globallySuppressed, savedEnvironmentRuntimeById, serverConfig, tick]);

  return null;
}
