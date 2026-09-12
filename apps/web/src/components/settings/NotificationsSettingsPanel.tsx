import type { DesktopCompletionSpeechCapability } from "@cafecode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  addCompletionAlertFiles,
  COMPLETION_ALERT_MAX_FILES,
  listCompletionAlertFiles,
  removeCompletionAlertFile,
  type CompletionAlertFileMetadata,
} from "../../completionAlertFiles";
import {
  isCompletionAlertCancelled,
  playCustomCompletionAlert,
  testCompletionAlerts,
  type CompletionAlertPlaybackReport,
} from "../../completionAlerts";
import {
  describeDesktopCompletionSpeech,
  shouldOfferWindowsSpeechGuide,
  WINDOWS_SPEECH_GUIDE_URL,
} from "../../completionSpeechSupport";
import { isElectron } from "../../env";
import {
  useLocalClientSettingsHydrated,
  useSettings,
  useUpdateSettings,
} from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import {
  disableWebPushNotifications,
  enableWebPushNotifications,
  getWebPushSupport,
} from "../../lib/webPushNotifications";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function browserVoiceMatchesLanguage(voice: SpeechSynthesisVoice, language: "en" | "ja"): boolean {
  const normalized = voice.lang.toLowerCase();
  return normalized === language || normalized.startsWith(`${language}-`);
}

/**
 * Browser Web Speech is always described as a *fallback*: it is centered and
 * sequential, and the Web Speech API exposes neither a trustworthy gender nor
 * per-utterance panning. It must never be presented as the native path.
 */
function browserSpeechSummary(): string {
  if (typeof speechSynthesis === "undefined") {
    return "Web Speech is unavailable in this browser.";
  }
  let voices: SpeechSynthesisVoice[];
  try {
    voices = speechSynthesis.getVoices();
  } catch {
    return "Browser fallback voices could not be queried.";
  }
  const english = voices.some((voice) => browserVoiceMatchesLanguage(voice, "en"));
  const japanese = voices.some((voice) => browserVoiceMatchesLanguage(voice, "ja"));
  return `Browser fallback: centered and sequential (English ${english ? "available" : "not found"}; Japanese ${japanese ? "available" : "not found"}). Web Speech does not expose reliable gender or stereo panning.`;
}

/**
 * Per-device notifications toggle. The setting lives in client settings
 * (localStorage / desktop client store), so each device opts in separately:
 * the desktop app fires native OS notifications from the renderer, while
 * browsers register a Web Push subscription so notifications arrive even
 * when the tab is frozen or closed.
 */
export function NotificationsSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const settingsHydrated = useLocalClientSettingsHydrated();
  const [isApplying, setIsApplying] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const [customFiles, setCustomFiles] = useState<readonly CompletionAlertFileMetadata[]>([]);
  const [speechCapability, setSpeechCapability] =
    useState<DesktopCompletionSpeechCapability | null>(null);
  const [, setBrowserVoiceRevision] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Monotonic request id: a stale "refresh voices" reply must never overwrite a
  // newer capability read, and unmounting must discard whatever is in flight.
  const speechCapabilityRequestRef = useRef(0);
  // Closing settings must stop a preview that is still playing, and must stop
  // it from writing status text into an unmounted panel.
  const previewAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      previewAbortRef.current?.abort();
      previewAbortRef.current = null;
    },
    [],
  );

  const startPreview = useCallback((): AbortSignal => {
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    return controller.signal;
  }, []);

  const webPushSupport = getWebPushSupport();
  const toggleDisabled = isApplying || (!isElectron && !webPushSupport.supported);

  // The persisted setting is authoritative for this device. Once it has
  // hydrated, if it reads off but a push subscription is still live — e.g. one
  // orphaned before notificationsEnabled persisted correctly — tear it down so
  // pushes actually stop instead of arriving while the toggle reads off. Gated
  // on hydration so we never unsubscribe during the pre-hydration window (when
  // the setting transiently defaults to off); a no-op when nothing is subscribed.
  useEffect(() => {
    if (
      isElectron ||
      !webPushSupport.supported ||
      !settingsHydrated ||
      isApplying ||
      settings.notificationsEnabled
    ) {
      return;
    }
    void disableWebPushNotifications().catch(() => {});
  }, [settingsHydrated, isApplying, settings.notificationsEnabled, webPushSupport.supported]);

  const handleToggle = async (nextEnabled: boolean) => {
    setToggleError(null);
    if (isElectron) {
      // The desktop app notifies from the renderer; no registration needed.
      updateSettings({ notificationsEnabled: nextEnabled });
      return;
    }
    setIsApplying(true);
    try {
      if (nextEnabled) {
        await enableWebPushNotifications();
      } else {
        await disableWebPushNotifications();
      }
      updateSettings({ notificationsEnabled: nextEnabled });
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : "Could not update notifications.");
    } finally {
      setIsApplying(false);
    }
  };

  /**
   * Real installed-voice status only. When the desktop bridge cannot answer we
   * say so explicitly instead of implying that a native voice exists.
   */
  const refreshSpeechCapability = useCallback(() => {
    if (!isElectron) return;
    const request = ++speechCapabilityRequestRef.current;
    const getCapability = window.desktopBridge?.getCompletionSpeechCapability;
    if (!getCapability) {
      setSpeechCapability({
        available: false,
        engine: "Windows System.Speech",
        voices: [],
        reason: "Native speech capability is unavailable in this desktop build.",
      });
      return;
    }
    void getCapability()
      .then((capability) => {
        if (request === speechCapabilityRequestRef.current) setSpeechCapability(capability);
      })
      .catch(() => {
        if (request === speechCapabilityRequestRef.current) {
          setSpeechCapability({
            available: false,
            engine: "Windows System.Speech",
            voices: [],
            reason: "Native speech capability could not be queried.",
          });
        }
      });
  }, []);

  useEffect(() => {
    void listCompletionAlertFiles()
      .then(setCustomFiles)
      .catch((error: unknown) =>
        setAudioStatus(error instanceof Error ? error.message : "Local alert storage unavailable."),
      );
  }, []);

  useEffect(() => {
    refreshSpeechCapability();
    // Invalidate any in-flight capability read so it cannot set state after
    // this panel closes.
    return () => {
      speechCapabilityRequestRef.current += 1;
    };
  }, [refreshSpeechCapability]);

  // Browsers populate `getVoices()` asynchronously, so the fallback summary has
  // to re-render once the engine finishes loading its voice list.
  useEffect(() => {
    if (isElectron || typeof speechSynthesis === "undefined") return;
    if (
      typeof speechSynthesis.addEventListener !== "function" ||
      typeof speechSynthesis.removeEventListener !== "function"
    ) {
      return;
    }
    const handleVoicesChanged = () => setBrowserVoiceRevision((revision) => revision + 1);
    speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
    return () => speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
  }, []);

  const completionPreferences = {
    language: settings.completionAlertLanguage,
    englishGender: settings.completionAlertEnglishVoiceGender,
    japaneseGender: settings.completionAlertJapaneseVoiceGender,
    stereoOrder: settings.completionAlertDualStereoOrder,
  } as const;

  const handleTest = async () => {
    const signal = startPreview();
    setAudioStatus("Testing completion alerts\u2026");
    try {
      const reports = await testCompletionAlerts({
        soundEnabled: settings.completionAlertSoundEnabled,
        speechEnabled: settings.completionAlertSpeechEnabled,
        preferences: completionPreferences,
        signal,
      });
      if (signal.aborted) return;
      setAudioStatus(
        reports.length > 0
          ? reports.map((report: CompletionAlertPlaybackReport) => report.message).join(" ")
          : "Turn on alert sound or spoken alert before testing.",
      );
    } catch (error) {
      if (isCompletionAlertCancelled(error) || signal.aborted) return;
      setAudioStatus(error instanceof Error ? error.message : "Could not test completion alerts.");
    }
  };

  const handleOpenWindowsSpeechGuide = () => {
    void (async () => {
      try {
        await ensureLocalApi().shell.openExternal(WINDOWS_SPEECH_GUIDE_URL);
      } catch (error) {
        setAudioStatus(
          error instanceof Error ? error.message : "Could not open the Microsoft voice guide.",
        );
      }
    })();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAudioStatus("Checking local audio files\u2026");
    try {
      setCustomFiles(await addCompletionAlertFiles(Array.from(files)));
      setAudioStatus("Saved locally on this device. Files are never uploaded.");
    } catch (error) {
      setAudioStatus(error instanceof Error ? error.message : "Could not save local alert files.");
    } finally {
      // Clearing the input lets the same file be re-picked after a rejection.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const description = isElectron
    ? "Show a system notification when a thread finishes running. Applies to this computer only."
    : "Show a system notification when a thread finishes running, even while this browser is in the background. Applies to this device only.";

  return (
    <SettingsPageContainer>
      <SettingsSection title="Notifications">
        <SettingsRow
          title="Thread completion notifications"
          description={description}
          control={
            <Switch
              checked={settings.notificationsEnabled}
              disabled={toggleDisabled}
              onCheckedChange={(checked) => {
                void handleToggle(Boolean(checked));
              }}
              aria-label="Enable thread completion notifications"
            />
          }
        />
        {!isElectron && !webPushSupport.supported ? (
          <p className="px-1 text-xs text-muted-foreground">
            {webPushSupport.reason === "insecure-context"
              ? "Push notifications require an HTTPS connection to the server. Reconnect over HTTPS to enable them on this device."
              : "This browser does not support push notifications. On iOS, add the app to your home screen first."}
          </p>
        ) : null}
        {toggleError ? <p className="px-1 text-xs text-destructive">{toggleError}</p> : null}
      </SettingsSection>

      <SettingsSection title="Completion audio">
        <SettingsRow
          title="Alert sound"
          description="Play a soft original two-tone ping, or cycle through the local files below, only after an observed running turn completes. Applies to this device only."
          control={
            <Switch
              checked={settings.completionAlertSoundEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ completionAlertSoundEnabled: Boolean(checked) })
              }
              aria-label="Enable completion alert sound"
            />
          }
        />
        <SettingsRow
          title="Spoken alert"
          description={
            "Speak only the fixed generic phrase \u201CTask complete.\u201D and/or \u201C\u4F5C\u696D\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002\u201D Prompt, thread, and project text is never spoken."
          }
          control={
            <Switch
              checked={settings.completionAlertSpeechEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ completionAlertSpeechEnabled: Boolean(checked) })
              }
              aria-label="Enable spoken completion alert"
            />
          }
        />
        <SettingsRow
          title="Speech language"
          description="Choose English, Japanese, or both. This is an explicit speech-output choice and is independent of any interface language."
          control={
            <select
              className={selectClassName}
              value={settings.completionAlertLanguage}
              onChange={(event) =>
                updateSettings({
                  completionAlertLanguage: event.currentTarget.value as "en" | "ja" | "dual",
                })
              }
              aria-label="Completion speech language"
            >
              <option value="en">English</option>
              <option value="ja">Japanese</option>
              <option value="dual">English + Japanese</option>
            </select>
          }
        />
        <SettingsRow
          title="English voice preference"
          description="Matched against the installed OS voice gender on Windows native speech; browser engines cannot reliably expose gender."
          control={
            <select
              className={selectClassName}
              value={settings.completionAlertEnglishVoiceGender}
              onChange={(event) =>
                updateSettings({
                  completionAlertEnglishVoiceGender: event.currentTarget.value as "female" | "male",
                })
              }
              aria-label="English completion voice preference"
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          }
        />
        <SettingsRow
          title="Japanese voice preference"
          description="Configured separately from the English voice preference."
          control={
            <select
              className={selectClassName}
              value={settings.completionAlertJapaneseVoiceGender}
              onChange={(event) =>
                updateSettings({
                  completionAlertJapaneseVoiceGender: event.currentTarget.value as
                    | "female"
                    | "male",
                })
              }
              aria-label="Japanese completion voice preference"
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          }
        />
        {settings.completionAlertLanguage === "dual" ? (
          <SettingsRow
            title="Dual stereo order"
            description="Windows native speech attempts true simultaneous stereo. Browser Web Speech stays centered and sequential."
            control={
              <select
                className={selectClassName}
                value={settings.completionAlertDualStereoOrder}
                onChange={(event) =>
                  updateSettings({
                    completionAlertDualStereoOrder: event.currentTarget.value as
                      | "ja-left-en-right"
                      | "en-left-ja-right",
                  })
                }
                aria-label="Dual completion speech stereo order"
              >
                <option value="ja-left-en-right">Japanese left · English right</option>
                <option value="en-left-ja-right">English left · Japanese right</option>
              </select>
            }
          />
        ) : null}
        <div className="border-t border-border/60 px-4 py-3.5 sm:px-5">
          <p className="text-xs text-muted-foreground" role="status">
            {isElectron
              ? describeDesktopCompletionSpeech(speechCapability)
              : browserSpeechSummary()}
          </p>
          {isElectron ? (
            <p className="mt-2 text-xs text-muted-foreground">{browserSpeechSummary()}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {isElectron && shouldOfferWindowsSpeechGuide(speechCapability) ? (
              <>
                <Button variant="outline" size="sm" onClick={refreshSpeechCapability}>
                  Refresh Windows voices
                </Button>
                <Button variant="outline" size="sm" onClick={handleOpenWindowsSpeechGuide}>
                  Open Microsoft voice guide
                </Button>
              </>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleTest()}
              disabled={
                !settings.completionAlertSoundEnabled && !settings.completionAlertSpeechEnabled
              }
            >
              Test enabled completion alerts
            </Button>
          </div>
          {audioStatus ? (
            <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
              {audioStatus}
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Custom local alert sounds">
        <div className="space-y-3 px-4 py-3.5 sm:px-5">
          <p className="text-xs text-muted-foreground">
            Add up to {COMPLETION_ALERT_MAX_FILES} MP3/WAV files, 5 MiB and 15 seconds each. They
            stay in this device&apos;s IndexedDB, are never uploaded, and cycle in the order shown.
          </p>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
            multiple
            onChange={(event) => void handleFiles(event.currentTarget.files)}
            aria-label="Choose custom completion alert files"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={customFiles.length >= COMPLETION_ALERT_MAX_FILES}
          >
            Add local MP3/WAV
          </Button>
          {customFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No custom files. The built-in ping is used.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Custom completion alert files">
              {customFiles.map((file) => (
                <li
                  key={file.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
                >
                  <span className="min-w-0 text-xs">
                    <span className="block truncate font-medium">{file.name}</span>
                    <span className="text-muted-foreground">
                      {formatDuration(file.durationSeconds)} · {(file.size / 1024).toFixed(0)} KiB
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const signal = startPreview();
                        setAudioStatus(`Testing ${file.name}\u2026`);
                        void playCustomCompletionAlert(file.id, signal)
                          .then(() => {
                            if (!signal.aborted) setAudioStatus(`Played ${file.name}.`);
                          })
                          .catch((error: unknown) => {
                            if (isCompletionAlertCancelled(error) || signal.aborted) return;
                            setAudioStatus(
                              error instanceof Error ? error.message : "Could not play local file.",
                            );
                          });
                      }}
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void removeCompletionAlertFile(file.id)
                          .then(() =>
                            setCustomFiles((current) =>
                              current.filter((candidate) => candidate.id !== file.id),
                            ),
                          )
                          .catch((error: unknown) =>
                            setAudioStatus(
                              error instanceof Error
                                ? error.message
                                : "Could not remove local alert file.",
                            ),
                          );
                      }}
                      aria-label={`Remove ${file.name}`}
                    >
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
