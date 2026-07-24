import { useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { scopedThreadKey, scopeThreadRef } from "@cafecode/client-runtime";

import {
  createCompletionBurstCoalescer,
  isRunningToCompletedTransition,
  type CompletionBurstCoalescer,
  type CompletionTurnSnapshot,
} from "../completionAlertTransitions";
import { playCompletionSound, playCompletionSpeech } from "../completionAlerts";
import { isElectron } from "../env";
import { useClientSettingsHydrated, useSettings } from "../hooks/useSettings";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { filterThreadsForMeetingPrivacy } from "../meetingPrivacy";
import { useUiStateStore } from "../uiStateStore";

/**
 * Root completion watcher. It seeds an observed turn baseline after client
 * settings hydrate, then reacts only to the same turn moving from running to
 * completed. Electron additionally emits native OS notifications. Opt-in
 * completion audio runs in either the desktop renderer or an open browser.
 */
export function DesktopNotificationWatcher() {
  const settings = useSettings();
  const settingsHydrated = useClientSettingsHydrated();
  const allProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const allThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const meetingPrivacyEnabled = useUiStateStore((state) => state.meetingPrivacyEnabled);
  const meetingPrivacyHiddenProjectKeys = useUiStateStore(
    (state) => state.meetingPrivacyHiddenProjectKeys,
  );
  const threads = useMemo(
    () =>
      filterThreadsForMeetingPrivacy(allThreads, allProjects, {
        enabled: meetingPrivacyEnabled,
        hiddenProjectKeys: meetingPrivacyHiddenProjectKeys,
      }),
    [allProjects, allThreads, meetingPrivacyEnabled, meetingPrivacyHiddenProjectKeys],
  );
  const router = useRouter();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const activeThreadKey =
    routeTarget?.kind === "server" ? scopedThreadKey(routeTarget.threadRef) : null;
  const activeThreadKeyRef = useRef(activeThreadKey);
  activeThreadKeyRef.current = activeThreadKey;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const turnsByKeyRef = useRef<Map<string, CompletionTurnSnapshot> | null>(null);
  const coalescerRef = useRef<CompletionBurstCoalescer | null>(null);

  useEffect(() => {
    coalescerRef.current = createCompletionBurstCoalescer(() => {
      const current = settingsRef.current;
      void (async () => {
        if (current.completionAlertSoundEnabled) {
          await playCompletionSound().catch(() => undefined);
        }
        if (current.completionAlertSpeechEnabled) {
          await playCompletionSpeech({
            language: current.completionAlertLanguage,
            englishGender: current.completionAlertEnglishVoiceGender,
            japaneseGender: current.completionAlertJapaneseVoiceGender,
            stereoOrder: current.completionAlertDualStereoOrder,
          }).catch(() => undefined);
        }
      })();
    });
    return () => {
      coalescerRef.current?.dispose();
      coalescerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    const previous = turnsByKeyRef.current;
    const next = new Map<string, CompletionTurnSnapshot>();
    for (const thread of threads) {
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      next.set(key, {
        turnId: thread.latestTurn?.turnId ?? null,
        state: thread.latestTurn?.state ?? null,
      });
    }
    turnsByKeyRef.current = next;
    // First sync after hydration seeds the baseline without notifying.
    if (previous === null) return;

    for (const thread of threads) {
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      const nextTurn = next.get(key);
      if (!nextTurn || !isRunningToCompletedTransition(previous.get(key), nextTurn)) continue;

      if (
        settingsRef.current.completionAlertSoundEnabled ||
        settingsRef.current.completionAlertSpeechEnabled
      ) {
        coalescerRef.current?.notify();
      }

      if (
        !isElectron ||
        !settingsRef.current.notificationsEnabled ||
        typeof Notification === "undefined"
      ) {
        continue;
      }
      // Watching the thread with the window focused — nothing to announce.
      if (key === activeThreadKeyRef.current && document.hasFocus()) continue;

      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      const notification = new Notification(thread.title, {
        body: "Finished running",
        tag: `cafe-code-thread-${thread.id}`,
      });
      notification.addEventListener("click", () => {
        window.focus();
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        });
      });
    }
  }, [router, settingsHydrated, threads]);

  return null;
}
