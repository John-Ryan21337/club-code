import {
  defaultInstanceIdForDriver,
  type ServerProvider,
  type ThreadAutoNudgeSummary,
  type TurnId,
} from "@cafecode/contracts";
import { useEffect, useRef } from "react";

import { autoNudgeTerminalTurnKey, getAutoNudgeTurnLedger } from "../autoNudger";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  getConfirmedAutoNudgeArming,
  useAutoNudgeSuppressedState,
} from "../confirmedAutoNudgeArming";
import { readEnvironmentApi } from "../environmentApi";
import { getSavedEnvironmentRuntimeState } from "../environments/runtime";
import { readPrimaryEnvironmentDescriptor } from "../environments/primary";
import { newCommandId, newMessageId } from "../lib/utils";
import { manualFollowUpPriorityStore } from "../manualFollowUpPriorityStore";
import { getServerConfig } from "../rpc/serverState";
import { type EnvironmentState, useStore } from "../store";
import type { ThreadShell } from "../types";

/**
 * Cross-origin ports do not share localStorage notifications. This poll exists
 * only to import a durable Stop/revoke signal from another renderer; its
 * callback has no path to Auto Nudge scheduling or dispatch.
 */
const SUPPRESSION_RECONCILIATION_INTERVAL_MS = 250;

interface BackgroundAutoNudgeAuthority {
  readonly key: string;
  readonly terminalKey: string;
  readonly routeKey: string;
  readonly environmentId: ThreadShell["environmentId"];
  readonly threadId: ThreadShell["id"];
  readonly authorityRevision: ThreadAutoNudgeSummary["authorityRevision"];
  readonly completedTurnId: TurnId;
}

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
  return `${terminalKey(shell, completedTurnId)}:${config.authorityRevision}`;
}

function terminalKey(shell: ThreadShell, completedTurnId: string): string {
  return autoNudgeTerminalTurnKey({
    environmentId: shell.environmentId,
    threadId: shell.id,
    completedTurnId,
  });
}

function routeKey(shell: ThreadShell): string {
  return JSON.stringify([shell.environmentId, shell.id]);
}

function projectedCompletedTurnKey(
  environment: EnvironmentState | undefined,
  threadId: ThreadShell["id"],
): string | null {
  if (!environment?.bootstrapComplete) return null;
  const shell = environment.threadShellById[threadId];
  const summary = environment.sidebarThreadSummaryById[threadId];
  const latestTurn =
    environment.threadTurnStateById[threadId]?.latestTurn ?? summary?.latestTurn ?? null;
  return shell && latestTurn?.state === "completed" && latestTurn.completedAt
    ? terminalKey(shell, latestTurn.turnId)
    : null;
}

function stopKey(shell: ThreadShell, config: ThreadAutoNudgeSummary): string {
  return `${shell.environmentId}:${shell.id}:${config.authorityRevision}`;
}

/**
 * Reads one exact provider-confirmed terminal identity from projection state.
 * This function never consults a clock: elapsed idle time cannot manufacture
 * an authority.
 */
function projectedAuthority(
  environment: EnvironmentState | undefined,
  threadId: ThreadShell["id"],
): BackgroundAutoNudgeAuthority | null {
  if (!environment?.bootstrapComplete) return null;
  const shell = environment.threadShellById[threadId];
  if (!shell) return null;
  const config = shell.autoNudge;
  if (
    config.mode === "off" ||
    !config.backgroundContinuation ||
    shell.archivedAt !== null ||
    config.roundsDispatched >= config.maxRounds ||
    config.armedAt === null
  ) {
    return null;
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
    return null;
  }

  return {
    key: authorityKey(shell, config, latestTurn.turnId),
    terminalKey: terminalKey(shell, latestTurn.turnId),
    routeKey: routeKey(shell),
    environmentId: shell.environmentId,
    threadId: shell.id,
    authorityRevision: config.authorityRevision,
    completedTurnId: latestTurn.turnId,
  };
}

/**
 * Schedules every independently opted-in thread from prompt-free shell state.
 *
 * There is deliberately no periodic or elapsed-idle Auto Nudge. The renderer
 * may dispatch only when projection state changes to a new provider-confirmed
 * completed turn. The exact environment server rechecks the thread, authority
 * revision, terminal turn, empty manual queue, caps, and background permission,
 * then reads that thread's persisted prompt. Concurrent renderers may race,
 * but only one serialized command can consume a terminal turn.
 */
export function BackgroundAutoNudgeCoordinator() {
  const globallySuppressed = useAutoNudgeSuppressedState();
  const environmentStateById = useStore((store) => store.environmentStateById);
  const observedCompletedTurnByRouteRef = useRef(new Map<string, string | null>());
  const pendingCompletedTurnByRouteRef = useRef(new Map<string, string>());
  const stopRequestsRef = useRef(new Set<string>());

  // Cross-port suppression polling is intentionally isolated from the
  // projection-driven dispatch effect below. This effect can only revoke.
  useEffect(() => {
    const arming = getConfirmedAutoNudgeArming();
    const reconcileSuppressedStops = () => {
      const liveStopKeys = new Set<string>();
      // localStorage change events do not cross localhost ports. Re-read the
      // host-scoped durable cookie so a renderer on a previous desktop port
      // converges enabled threads to Off without gaining dispatch authority.
      arming.synchronizeSuppressionFromStorage();
      // synchronizeSuppressionFromStorage updates the snapshot synchronously.
      // Reading the render-time hook value here could issue one stale Stop
      // after another renderer has explicitly cleared the durable barrier.
      const suppressionActive = arming.getSuppressedSnapshot();

      if (suppressionActive) {
        for (const environment of Object.values(useStore.getState().environmentStateById)) {
          if (!environment.bootstrapComplete) continue;
          for (const threadId of environment.threadIds) {
            const shell = environment.threadShellById[threadId];
            if (!shell) continue;
            const config = shell.autoNudge;
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
          }
        }
      }

      for (const requestKey of stopRequestsRef.current) {
        if (!liveStopKeys.has(requestKey)) {
          stopRequestsRef.current.delete(requestKey);
        }
      }
    };

    reconcileSuppressedStops();
    const timer = window.setInterval(
      reconcileSuppressedStops,
      SUPPRESSION_RECONCILIATION_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [globallySuppressed]);

  // Only a projection transition to a different completed-turn identity may
  // dispatch. Initial hydration and config changes merely establish context.
  useEffect(() => {
    if (getConfirmedAutoNudgeArming().getSuppressedSnapshot()) {
      return;
    }
    const liveRoutes = new Set<string>();

    for (const environment of Object.values(environmentStateById)) {
      if (!environment.bootstrapComplete) continue;
      for (const threadId of environment.threadIds) {
        const shell = environment.threadShellById[threadId];
        if (!shell) continue;
        const currentRouteKey = routeKey(shell);
        liveRoutes.add(currentRouteKey);
        const completedTurnKey = projectedCompletedTurnKey(environment, threadId);
        const hadPrevious = observedCompletedTurnByRouteRef.current.has(currentRouteKey);
        const previousCompletedTurnKey =
          observedCompletedTurnByRouteRef.current.get(currentRouteKey) ?? null;
        observedCompletedTurnByRouteRef.current.set(currentRouteKey, completedTurnKey);
        if (!hadPrevious) {
          // Initial hydration establishes a baseline and cannot authorize work.
          pendingCompletedTurnByRouteRef.current.delete(currentRouteKey);
          continue;
        }
        if (completedTurnKey !== previousCompletedTurnKey) {
          if (completedTurnKey === null) {
            pendingCompletedTurnByRouteRef.current.delete(currentRouteKey);
          } else {
            pendingCompletedTurnByRouteRef.current.set(currentRouteKey, completedTurnKey);
          }
        }
        const pendingCompletedTurnKey =
          pendingCompletedTurnByRouteRef.current.get(currentRouteKey) ?? null;
        if (completedTurnKey === null || pendingCompletedTurnKey !== completedTurnKey) {
          continue;
        }

        const authority = projectedAuthority(environment, threadId);
        if (!authority) continue;
        const ledger = getAutoNudgeTurnLedger();
        if (ledger.has(authority.terminalKey) || ledger.has(authority.key)) {
          pendingCompletedTurnByRouteRef.current.delete(currentRouteKey);
          continue;
        }

        const currentAuthority = projectedAuthority(environment, threadId);
        if (!currentAuthority || currentAuthority.key !== authority.key) continue;
        const summary = environment.sidebarThreadSummaryById[threadId];
        const session = environment.threadSessionById[threadId] ?? summary?.session ?? null;
        if (!summary || !session) continue;
        if (
          shell.manualFollowUpCount > 0 ||
          manualFollowUpPriorityStore.has({
            environmentId: authority.environmentId,
            threadId: authority.threadId,
          })
        ) {
          ledger.mark(authority.terminalKey);
          pendingCompletedTurnByRouteRef.current.delete(currentRouteKey);
          continue;
        }
        const draft = useComposerDraftStore.getState().getComposerDraft({
          environmentId: authority.environmentId,
          threadId: authority.threadId,
        });
        if (Boolean(draft?.prompt.trim()) || (draft?.images.length ?? 0) > 0) {
          ledger.mark(authority.terminalKey);
          pendingCompletedTurnByRouteRef.current.delete(currentRouteKey);
          continue;
        }
        if (
          summary.hasPendingApprovals ||
          summary.hasPendingUserInput ||
          summary.hasActionableProposedPlan ||
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
          authority.environmentId === readPrimaryEnvironmentDescriptor()?.environmentId
            ? getServerConfig()
            : getSavedEnvironmentRuntimeState(authority.environmentId).serverConfig;
        const provider =
          environmentServerConfig?.providers.find(
            (entry) => entry.instanceId === providerInstanceId,
          ) ?? null;
        if (!providerCanAcceptTurn(provider)) continue;
        const api = readEnvironmentApi(authority.environmentId);
        if (!api) continue;
        const arming = getConfirmedAutoNudgeArming();
        if (!arming.confirmExecutionAuthorized()) continue;
        ledger.mark(authority.terminalKey);
        pendingCompletedTurnByRouteRef.current.delete(currentRouteKey);
        if (!arming.confirmExecutionAuthorized()) continue;
        void api.orchestration
          .dispatchCommand({
            type: "thread.auto-nudge.dispatch",
            commandId: newCommandId(),
            threadId: authority.threadId,
            expectedAuthorityRevision: authority.authorityRevision,
            completedTurnId: authority.completedTurnId,
            dispatchSource: "background",
            messageId: newMessageId(),
            createdAt: new Date().toISOString(),
          })
          .catch(() => {
            // Fail closed. Only a different completion event can dispatch.
          });
      }
    }

    for (const observedRouteKey of observedCompletedTurnByRouteRef.current.keys()) {
      if (!liveRoutes.has(observedRouteKey)) {
        observedCompletedTurnByRouteRef.current.delete(observedRouteKey);
        pendingCompletedTurnByRouteRef.current.delete(observedRouteKey);
      }
    }
  }, [environmentStateById, globallySuppressed]);

  return null;
}
