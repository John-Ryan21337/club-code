import { useEffect, useRef } from "react";
import { useParams, useRouter } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { scopedThreadKey, scopeThreadRef } from "@cafecode/client-runtime";

import { selectSidebarThreadsAcrossEnvironments, useStore } from "../store";
import {
  collectCompletionTransitionKeys,
  createCompletionBurstCoalescer,
  type CompletionBurstCoalescer,
  type CompletionTurnSnapshot,
} from "../completionAlertTransitions";
import { runCompletionAlert, type CompletionAlertRun } from "../completionAlertRun";
import { isElectron } from "../env";
import { useLocalClientSettingsHydrated, useSettings } from "../hooks/useSettings";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";

/**
 * Desktop-app counterpart of Web Push: the Electron renderer keeps its
 * WebSocket alive while backgrounded, so it can fire native OS notifications
 * directly (the HTML5 Notification API maps to Windows/macOS/Linux native
 * notifications in Electron, no permission prompt needed). Fires when a
 * thread's turn settles, unless the user is focused on that very thread.
 *
 * It also owns the opt-in completion audio, which is deliberately a *separate*
 * observer from the native-notification one above:
 *
 * - Native notifications stay Electron-only and keep reacting to the session
 *   running flag, exactly as before.
 * - Completion audio runs in the desktop renderer *and* in an open browser tab,
 *   reacts only to the same observed turn moving `running` -> `completed`, and
 *   waits for client settings to hydrate before it seeds a baseline. That
 *   ordering is what stops hydration or a store refill from
 *   replaying audio for work that finished while nobody was listening.
 */
export function DesktopNotificationWatcher() {
  const settings = useSettings();
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const router = useRouter();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const activeThreadKey =
    routeTarget?.kind === "server" ? scopedThreadKey(routeTarget.threadRef) : null;
  const activeThreadKeyRef = useRef(activeThreadKey);
  activeThreadKeyRef.current = activeThreadKey;
  const notificationsEnabledRef = useRef(settings.notificationsEnabled);
  notificationsEnabledRef.current = settings.notificationsEnabled;
  const runningByKeyRef = useRef<Map<string, boolean> | null>(null);
  const settingsHydrated = useLocalClientSettingsHydrated();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Per-turn snapshots for completion audio only. Kept apart from
  // `runningByKeyRef` so the audio transition rule cannot drift into the
  // notification rule (or vice versa) when either one is changed later.
  const turnsByKeyRef = useRef<Map<string, CompletionTurnSnapshot> | null>(null);
  const coalescerRef = useRef<CompletionBurstCoalescer | null>(null);
  // The abort handles of the alert that is playing right now, so a settings
  // change or an unmount can stop audio that is already sounding.
  const runRef = useRef<CompletionAlertRun | null>(null);

  // One coalescer for the component's lifetime: a fan-out of threads finishing
  // together should produce a single alert, and a second burst waits out the
  // cooldown instead of stacking overlapping AudioContexts. Disposed on unmount
  // so no pending timer can fire audio into a torn-down renderer, and the
  // in-flight run is aborted so neither playing audio nor a late native speech
  // response can outlive the renderer.
  useEffect(() => {
    const coalescer = createCompletionBurstCoalescer(async () => {
      const run: CompletionAlertRun = {
        sound: new AbortController(),
        speech: new AbortController(),
      };
      runRef.current = run;
      try {
        // Every switch is re-read at each stage rather than captured once, so
        // turning audio off during the sound also suppresses the speech that
        // would have followed it.
        await runCompletionAlert({
          run,
          isSoundEnabled: () => settingsRef.current.completionAlertSoundEnabled,
          isSpeechEnabled: () => settingsRef.current.completionAlertSpeechEnabled,
          getPreferences: () => ({
            language: settingsRef.current.completionAlertLanguage,
            englishGender: settingsRef.current.completionAlertEnglishVoiceGender,
            japaneseGender: settingsRef.current.completionAlertJapaneseVoiceGender,
            stereoOrder: settingsRef.current.completionAlertDualStereoOrder,
          }),
        });
      } finally {
        if (runRef.current === run) runRef.current = null;
      }
    });
    coalescerRef.current = coalescer;
    return () => {
      coalescer.dispose();
      coalescerRef.current = null;
      runRef.current?.sound.abort();
      runRef.current?.speech.abort();
      runRef.current = null;
    };
  }, []);

  // Switching a half of completion audio off is a stop, not just a mute for
  // next time: abort that stage of the alert that is playing right now.
  useEffect(() => {
    if (!settings.completionAlertSoundEnabled) runRef.current?.sound.abort();
    if (!settings.completionAlertSpeechEnabled) runRef.current?.speech.abort();
  }, [settings.completionAlertSoundEnabled, settings.completionAlertSpeechEnabled]);

  useEffect(() => {
    // Until client settings hydrate, both switches read as their `false`
    // default, so seeding here would let a later hydration look like a fresh
    // completion. Wait, then seed silently.
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
    // First sync after hydration seeds the baseline without playing anything.
    if (previous === null) return;
    if (
      !settingsRef.current.completionAlertSoundEnabled &&
      !settingsRef.current.completionAlertSpeechEnabled
    ) {
      return;
    }
    // One coalesced alert covers a whole batch of threads finishing together.
    if (collectCompletionTransitionKeys(previous, next).length > 0) {
      coalescerRef.current?.notify();
    }
  }, [settingsHydrated, threads]);

  useEffect(() => {
    if (!isElectron) return;
    const previous = runningByKeyRef.current;
    const next = new Map<string, boolean>();
    for (const thread of threads) {
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      next.set(key, thread.session?.status === "running" && thread.session.activeTurnId != null);
    }
    runningByKeyRef.current = next;
    // First sync after load: seed the baseline without notifying.
    if (previous === null) return;
    if (!notificationsEnabledRef.current) return;
    if (typeof Notification === "undefined") return;

    for (const thread of threads) {
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      if (previous.get(key) !== true || next.get(key) !== false) continue;
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
  }, [router, threads]);

  return null;
}
