import {
  defaultInstanceIdForDriver,
  EnvironmentId,
  MessageId,
  type ServerProvider,
  ThreadId,
} from "@cafecode/contracts";
import { useEffect } from "react";

import {
  decideBackgroundAutoNudgeRootAction,
  getBackgroundAutoNudgeController,
  supportsBackgroundAutoNudgeDispatchLock,
  useBackgroundAutoNudgeState,
} from "../backgroundAutoNudger";
import { getAutoNudgeTurnLedger } from "../autoNudger";
import {
  AUTO_NUDGE_EXECUTION_LOCK_NAME,
  getAutoNudgeThreadPolicyStore,
} from "../autoNudgeThreadPolicy";
import { useComposerDraftStore } from "../composerDraftStore";
import { readEnvironmentApi } from "../environmentApi";
import { useSettings } from "../hooks/useSettings";
import { newCommandId, newMessageId } from "../lib/utils";
import { useServerConfig } from "../rpc/serverState";
import { useStore } from "../store";

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
  // Subscribe to draft-map revisions so a newly typed owner draft triggers a
  // prompt coordinator pass. The exact owner draft is resolved again under
  // the execution lock after durable ownership is reloaded.
  const composerDraftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  useEffect(() => {
    const controller = getBackgroundAutoNudgeController();
    if (!backgroundState.owner || backgroundState.status !== "active") return;
    // PR7's root shell projection cannot observe the exact thread's local
    // manual follow-up FIFO after navigation. Do not let an automated prompt
    // overtake operator input. PR8 may enable this only after it supplies
    // durable exact-thread queue truth to this coordinator.
    if (decideBackgroundAutoNudgeRootAction(false) === "pause-missing-manual-queue-truth") {
      controller.pause(
        backgroundState.owner,
        "Background continuation is waiting for exact-thread manual queue state.",
      );
      return;
    }
    // localStorage alone has no compare-and-swap. Chromium/Electron's lock
    // serializes reload -> consume -> transport handoff across renderer tabs;
    // an older browser pauses instead of permitting an ambiguous duplicate.
    if (!supportsBackgroundAutoNudgeDispatchLock()) {
      controller.pause(
        backgroundState.owner,
        "Background continuation requires a cross-tab dispatch lock.",
      );
      return;
    }

    void navigator.locks
      .request(AUTO_NUDGE_EXECUTION_LOCK_NAME, { ifAvailable: true, mode: "exclusive" }, (lock) => {
        if (!lock) return;
        controller.reloadFromStorage();
        const policyStore = getAutoNudgeThreadPolicyStore();
        policyStore.reloadFromStorage();
        let currentState = controller.getSnapshot();
        const owner = currentState.owner;
        if (!owner || currentState.status !== "active") return;

        let ownerPolicy = policyStore.getPolicy(owner);
        // One narrow migration path preserves an already-running v1 owner.
        // Legacy device-wide settings are never copied to arbitrary focused
        // threads: only the exact durable owner may inherit them once.
        if (
          !currentState.runPolicy &&
          !policyStore.hasPolicy(owner) &&
          settings.autoNudgeBackgroundContinuation &&
          settings.autoNudgeMode !== "off"
        ) {
          ownerPolicy = policyStore.setPolicy(owner, {
            mode: settings.autoNudgeMode,
            backgroundContinuation: true,
            maxRounds: settings.autoNudgeMaxRounds,
          });
        }
        controller.synchronizePolicy(owner, ownerPolicy);
        currentState = controller.getSnapshot();
        if (
          !currentState.owner ||
          currentState.status !== "active" ||
          currentState.owner.environmentId !== owner.environmentId ||
          currentState.owner.threadId !== owner.threadId
        ) {
          return;
        }

        const environment = environmentStateById[owner.environmentId];
        // Reload/remount must wait for the authoritative shell snapshot. Treating
        // an unhydrated store as a deleted thread would destroy valid ownership.
        if (!environment?.bootstrapComplete || !serverConfig) return;
        const ownedThreadId = ThreadId.make(owner.threadId);
        const ownerComposerDraft = useComposerDraftStore.getState().getComposerDraft({
          environmentId: EnvironmentId.make(owner.environmentId),
          threadId: ownedThreadId,
        });
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
          serverConfig?.providers.find((entry) => entry.instanceId === providerInstanceId) ?? null;
        const terminalTurnKey =
          shell &&
          latestTurn?.state === "completed" &&
          latestTurn.completedAt &&
          session?.status === "ready"
            ? `${owner.environmentId}:${owner.threadId}:${latestTurn.turnId}`
            : null;
        const ledger = getAutoNudgeTurnLedger();
        ledger.reloadFromStorage();

        const dispatch = controller.observe({
          nowMs: Date.now(),
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
        if (!controller.getSnapshot().owner && ownerPolicy.backgroundContinuation) {
          policyStore.setPolicy(owner, { backgroundContinuation: false });
        }
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
      })
      .catch(() => {
        if (backgroundState.owner) {
          controller.pause(
            backgroundState.owner,
            "Background continuation could not acquire a cross-tab dispatch lock.",
          );
        }
      });
  }, [
    backgroundState,
    composerDraftsByThreadKey,
    environmentStateById,
    serverConfig,
    settings.autoNudgeBackgroundContinuation,
    settings.autoNudgeMaxRounds,
    settings.autoNudgeMode,
  ]);

  return null;
}
