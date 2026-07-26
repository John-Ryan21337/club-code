import {
  defaultInstanceIdForDriver,
  EnvironmentId,
  type ServerProvider,
  ThreadId,
} from "@cafecode/contracts";
import { useEffect, useState } from "react";

import {
  getBackgroundAutoNudgeController,
  supportsBackgroundAutoNudgeDispatchLock,
  useBackgroundAutoNudgeState,
} from "../backgroundAutoNudger";
import {
  autoNudgeDispatchIdentityForTurn,
  getAutoNudgeTurnLedger,
  normalizeAutoNudgeTerminalTurnKey,
  providerCanAcceptAutoNudgeTurn,
  withAutoNudgeDispatchSource,
} from "../autoNudger";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  getConfirmedAutoNudgeArming,
  useAutoNudgeSuppressedState,
} from "../confirmedAutoNudgeArming";
import { readEnvironmentApi } from "../environmentApi";
import { getClientSettings, useSettings } from "../hooks/useSettings";
import { getServerConfig, useServerConfig } from "../rpc/serverState";
import { isLatestTurnSettled } from "../session-logic";
import { useStore } from "../store";

const COORDINATOR_TICK_MS = 250;

function providerIsRuntimeReady(provider: ServerProvider | null): boolean {
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
  return providerCanAcceptAutoNudgeTurn(provider);
}

/**
 * Owns the opt-in continuation lifecycle above every ChatView. It observes the
 * all-thread shell projection, so route navigation and settings remounts do not
 * become execution or cancellation signals.
 */
export function BackgroundAutoNudgeCoordinator() {
  const backgroundState = useBackgroundAutoNudgeState();
  const autoNudgeSuppressed = useAutoNudgeSuppressedState();
  const settings = useSettings();
  const serverConfig = useServerConfig();
  const environmentStateById = useStore((store) => store.environmentStateById);
  const ownerComposerDraft = useComposerDraftStore((store) => {
    const owner = backgroundState.owner;
    if (!owner) return null;
    return store.getComposerDraft({
      environmentId: EnvironmentId.make(owner.environmentId),
      threadId: ThreadId.make(owner.threadId),
    });
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (backgroundState.status !== "active") return;
    const timer = window.setInterval(() => setTick((value) => value + 1), COORDINATOR_TICK_MS);
    return () => window.clearInterval(timer);
  }, [backgroundState.status]);

  useEffect(() => {
    const controller = getBackgroundAutoNudgeController();
    if (!backgroundState.owner || backgroundState.status !== "active") return;
    let cancelled = false;
    // localStorage alone has no compare-and-swap. Chromium/Electron's lock
    // serializes reload -> consume -> transport handoff across renderer tabs;
    // an older browser pauses instead of permitting an ambiguous duplicate.
    if (!supportsBackgroundAutoNudgeDispatchLock()) {
      controller.pause("Background continuation requires a cross-tab dispatch lock.");
      return;
    }

    void navigator.locks
      .request(
        "cafe-code.auto-nudge.background.dispatch.v1",
        { ifAvailable: true, mode: "exclusive" },
        (lock) => {
          if (!lock || cancelled) return;
          controller.reloadFromStorage();
          const currentState = controller.getSnapshot();
          const owner = currentState.owner;
          if (!owner || currentState.status !== "active") return;

          const currentEnvironmentStateById = useStore.getState().environmentStateById;
          const currentServerConfig = getServerConfig();
          const environment = currentEnvironmentStateById[owner.environmentId];
          // Reload/remount must wait for the authoritative shell snapshot. Treating
          // an unhydrated store as a deleted thread would destroy valid ownership.
          if (!environment?.bootstrapComplete || !currentServerConfig) return;
          const ownedThreadId = ThreadId.make(owner.threadId);
          const shell = environment?.threadShellById[ownedThreadId];
          const summary = environment?.sidebarThreadSummaryById[ownedThreadId];
          const session = environment?.threadSessionById[ownedThreadId] ?? summary?.session ?? null;
          const latestTurn =
            environment?.threadTurnStateById[ownedThreadId]?.latestTurn ??
            summary?.latestTurn ??
            null;
          const providerInstanceId =
            session?.providerInstanceId ??
            shell?.modelSelection.instanceId ??
            (session?.provider ? defaultInstanceIdForDriver(session.provider) : undefined);
          const provider =
            currentServerConfig.providers.find(
              (entry) => entry.instanceId === providerInstanceId,
            ) ?? null;
          const terminalTurnKey =
            shell &&
            latestTurn?.state === "completed" &&
            latestTurn.completedAt &&
            session?.status === "ready" &&
            isLatestTurnSettled(latestTurn, session)
              ? normalizeAutoNudgeTerminalTurnKey(
                  `${owner.environmentId}:${owner.threadId}:${latestTurn.turnId}`,
                )
              : null;
          const currentOwnerComposerDraft = useComposerDraftStore.getState().getComposerDraft({
            environmentId: EnvironmentId.make(owner.environmentId),
            threadId: ownedThreadId,
          });
          const ledger = getAutoNudgeTurnLedger();
          // Read after acquiring the dispatch lock. The coordinator can be
          // notified by controller.start in the same microtask that publishes
          // confirmed settings, before React has committed a new hook closure.
          // A synchronous snapshot prevents that render gap from interpreting
          // the just-confirmed enable as stale `false` and stopping the run.
          const currentSettings = getClientSettings();
          const arming = getConfirmedAutoNudgeArming();
          arming.synchronizeSuppressionFromStorage();
          const executionSuppressed = arming.getSuppressedSnapshot();

          const dispatch = controller.observe({
            nowMs: Date.now(),
            settings: {
              mode: executionSuppressed ? "off" : currentSettings.autoNudgeMode,
              enabled: !executionSuppressed && currentSettings.autoNudgeBackgroundContinuation,
              maxRounds: currentSettings.autoNudgeMaxRounds,
              maxMinutes: currentSettings.autoNudgeMaxMinutes,
            },
            thread:
              shell && summary
                ? {
                    exists: true,
                    archived: shell.archivedAt !== null,
                    terminalTurnKey,
                    latestUserMessageAt: summary.latestUserMessageAt,
                    sessionReady: session?.status === "ready",
                    sessionStarting:
                      session?.status === "connecting" ||
                      session?.orchestrationStatus === "starting",
                    isRunning:
                      session?.status === "running" ||
                      session?.orchestrationStatus === "running" ||
                      latestTurn?.state === "running",
                    hasPendingWork:
                      summary.hasPendingApprovals ||
                      summary.hasPendingUserInput ||
                      summary.hasActionableProposedPlan ||
                      Boolean(currentOwnerComposerDraft?.prompt.trim()) ||
                      (currentOwnerComposerDraft?.images.length ?? 0) > 0 ||
                      Boolean(shell.error),
                    providerAvailable: providerIsRuntimeReady(provider),
                  }
                : { exists: false },
            alreadyConsumed: (turnKey) => ledger.has(turnKey),
          });
          if (!dispatch || !shell || !latestTurn) return;

          // Consume before crossing the transport. A reload or lost ACK can skip one
          // nudge, but can never submit the same completed turn twice.
          ledger.mark(dispatch.terminalTurnKey);
          const api = readEnvironmentApi(shell.environmentId);
          if (!api) {
            controller.markDispatchFailed(
              dispatch.messageId,
              "Environment transport is unavailable; background continuation paused.",
            );
            return;
          }

          const identity = autoNudgeDispatchIdentityForTurn(dispatch.terminalTurnKey);
          void api.orchestration
            .dispatchCommand(
              withAutoNudgeDispatchSource(
                {
                  type: "thread.turn.start",
                  commandId: identity.commandId,
                  threadId: shell.id,
                  message: {
                    messageId: identity.messageId,
                    role: "user",
                    text: dispatch.prompt,
                    attachments: [],
                  },
                  expectedSettledTurnId: latestTurn.turnId,
                  modelSelection: shell.modelSelection,
                  titleSeed: shell.title,
                  runtimeMode: shell.runtimeMode,
                  interactionMode: shell.interactionMode,
                  createdAt: dispatch.createdAt,
                },
                identity,
              ),
            )
            .catch(() => {
              controller.markDispatchFailed(
                dispatch.messageId,
                "Transport acknowledgement was indeterminate; continuation paused.",
              );
            });
        },
      )
      .catch(() => {
        if (!cancelled) {
          controller.pause("Background continuation could not acquire a cross-tab dispatch lock.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    autoNudgeSuppressed,
    backgroundState,
    environmentStateById,
    ownerComposerDraft,
    serverConfig,
    settings.autoNudgeBackgroundContinuation,
    settings.autoNudgeMaxMinutes,
    settings.autoNudgeMaxRounds,
    settings.autoNudgeMode,
    tick,
  ]);

  return null;
}
