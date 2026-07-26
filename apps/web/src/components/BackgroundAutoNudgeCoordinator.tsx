import {
  defaultInstanceIdForDriver,
  EnvironmentId,
  MessageId,
  type ServerProvider,
  ThreadId,
} from "@cafecode/contracts";
import { useEffect, useState } from "react";

import {
  getBackgroundAutoNudgeController,
  supportsBackgroundAutoNudgeDispatchLock,
  useBackgroundAutoNudgeState,
} from "../backgroundAutoNudger";
import { getAutoNudgeTurnLedger } from "../autoNudger";
import { useComposerDraftStore } from "../composerDraftStore";
import { readEnvironmentApi } from "../environmentApi";
import { useSettings } from "../hooks/useSettings";
import { newCommandId, newMessageId } from "../lib/utils";
import { useServerConfig } from "../rpc/serverState";
import { useStore } from "../store";

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

/**
 * Owns the opt-in continuation lifecycle above every ChatView. It observes the
 * all-thread shell projection, so route navigation and settings remounts do not
 * become execution or cancellation signals.
 */
export function BackgroundAutoNudgeCoordinator() {
  const backgroundState = useBackgroundAutoNudgeState();
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
          if (!lock) return;
          controller.reloadFromStorage();
          const currentState = controller.getSnapshot();
          const owner = currentState.owner;
          if (!owner || currentState.status !== "active") return;

          const environment = environmentStateById[owner.environmentId];
          // Reload/remount must wait for the authoritative shell snapshot. Treating
          // an unhydrated store as a deleted thread would destroy valid ownership.
          if (!environment?.bootstrapComplete || !serverConfig) return;
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
            (session?.provider
              ? defaultInstanceIdForDriver(session.provider)
              : shell?.modelSelection.instanceId);
          const provider =
            serverConfig?.providers.find((entry) => entry.instanceId === providerInstanceId) ??
            null;
          const terminalTurnKey =
            shell &&
            latestTurn?.state === "completed" &&
            latestTurn.completedAt &&
            session?.status === "ready"
              ? `${owner.environmentId}:${owner.threadId}:${latestTurn.turnId}`
              : null;
          const ledger = getAutoNudgeTurnLedger();

          const dispatch = controller.observe({
            nowMs: Date.now(),
            settings: {
              mode: settings.autoNudgeMode,
              enabled: settings.autoNudgeBackgroundContinuation,
              maxRounds: settings.autoNudgeMaxRounds,
              maxMinutes: settings.autoNudgeMaxMinutes,
            },
            thread:
              shell && summary
                ? {
                    exists: true,
                    archived: shell.archivedAt !== null,
                    terminalTurnKey,
                    latestUserMessageAt: summary.latestUserMessageAt,
                    sessionReady: session?.status === "ready",
                    isRunning:
                      session?.status === "running" ||
                      session?.orchestrationStatus === "running" ||
                      latestTurn?.state === "running",
                    hasPendingWork:
                      summary.hasPendingApprovals ||
                      summary.hasPendingUserInput ||
                      summary.hasActionableProposedPlan ||
                      Boolean(ownerComposerDraft?.prompt.trim()) ||
                      (ownerComposerDraft?.images.length ?? 0) > 0 ||
                      Boolean(shell.error),
                    providerAvailable: providerCanAcceptTurn(provider),
                  }
                : { exists: false },
            alreadyConsumed: (turnKey) => ledger.has(turnKey),
            newMessageId: () => String(newMessageId()),
          });
          if (!dispatch || !shell) return;

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

          void api.orchestration
            .dispatchCommand({
              type: "thread.turn.start",
              commandId: newCommandId(),
              threadId: shell.id,
              message: {
                messageId: MessageId.make(dispatch.messageId),
                role: "user",
                text: dispatch.prompt,
                attachments: [],
              },
              modelSelection: shell.modelSelection,
              titleSeed: shell.title,
              runtimeMode: shell.runtimeMode,
              interactionMode: shell.interactionMode,
              createdAt: dispatch.createdAt,
            })
            .catch(() => {
              controller.markDispatchFailed(
                dispatch.messageId,
                "Provider or transport rejected the automated prompt; continuation paused.",
              );
            });
        },
      )
      .catch(() => {
        controller.pause("Background continuation could not acquire a cross-tab dispatch lock.");
      });
  }, [
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
