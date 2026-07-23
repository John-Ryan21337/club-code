import {
  DEFAULT_DESKTOP_WINDOW_OPACITY,
  MAX_DESKTOP_WINDOW_OPACITY,
  MIN_DESKTOP_WINDOW_OPACITY,
  type DesktopWindowOpacityState,
} from "@cafecode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { localMediaStore, useLocalMediaState } from "../../localMedia";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

function opacityStatus(state: DesktopWindowOpacityState | null): string | null {
  if (typeof window === "undefined" || !window.desktopBridge) {
    return "Whole-window opacity is available only in the desktop app.";
  }
  if (!state) {
    return "Checking desktop support…";
  }
  if (!state.supported) {
    return state.reason === "release-not-validated"
      ? "This desktop build has not passed the required native opacity smoke test."
      : "This platform does not provide a reliable Electron whole-window opacity API.";
  }
  switch (state.reason) {
    case "apply-failed":
      return "The requested opacity could not be applied. The window was restored to opaque.";
    case "persistence-failed":
      return "The window was rolled back because the preference could not be saved.";
    case "safe-reset-failed":
      return "Cafe Code could not confirm a complete recovery. Restart the desktop app.";
    default:
      return null;
  }
}

function isOpaqueWindowState(state: DesktopWindowOpacityState): boolean {
  return state.supported && state.enabled === false && state.effectiveOpacity === 1;
}

export function WindowOpacitySettings() {
  const settings = useSettings();
  const localMedia = useLocalMediaState();
  const { updateSettingsAsync } = useUpdateSettings();
  const [state, setState] = useState<DesktopWindowOpacityState | null>(null);
  const [opacityDraft, setOpacityDraft] = useState(DEFAULT_DESKTOP_WINDOW_OPACITY);
  const [pending, setPending] = useState(false);
  const [opacityLoadFailed, setOpacityLoadFailed] = useState(false);
  const [disableAllStatus, setDisableAllStatus] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const stateRef = useRef<DesktopWindowOpacityState | null>(null);
  const requestSequenceRef = useRef(0);
  const pendingSignatureRef = useRef<string | null>(null);

  const acceptState = useCallback((next: DesktopWindowOpacityState) => {
    stateRef.current = next;
    setState(next);
    setOpacityDraft(next.opacity);
  }, []);

  useEffect(() => {
    let active = true;
    const bridge = window.desktopBridge;
    if (!bridge) {
      return;
    }
    const requestSequence = ++requestSequenceRef.current;
    void bridge
      .getWindowOpacityState()
      .then((next) => {
        if (active && requestSequence === requestSequenceRef.current) {
          setOpacityLoadFailed(false);
          acceptState(next);
        }
      })
      .catch((error: unknown) => {
        if (!active || requestSequence !== requestSequenceRef.current) return;
        setOpacityLoadFailed(true);
        toastManager.add({
          title: "Could not read window opacity",
          description: error instanceof Error ? error.message : "The desktop bridge failed.",
          type: "error",
        });
      });
    return () => {
      active = false;
    };
  }, [acceptState]);

  const applyPreference = useCallback(
    async (enabled: boolean, opacity: number) => {
      const bridge = window.desktopBridge;
      if (!bridge) {
        return;
      }
      const current = stateRef.current;
      if (current?.enabled === enabled && current.opacity === opacity) {
        setOpacityDraft(opacity);
        return;
      }
      const signature = `${enabled}:${opacity}`;
      if (pendingSignatureRef.current === signature) {
        return;
      }
      pendingSignatureRef.current = signature;
      const requestSequence = ++requestSequenceRef.current;
      setPending(true);
      try {
        const next = await bridge.setWindowOpacityPreference({ enabled, opacity });
        if (requestSequence === requestSequenceRef.current) {
          acceptState(next);
        }
      } catch (error) {
        if (requestSequence === requestSequenceRef.current) {
          pendingSignatureRef.current = null;
          setOpacityDraft(stateRef.current?.opacity ?? DEFAULT_DESKTOP_WINDOW_OPACITY);
          toastManager.add({
            title: "Could not change window opacity",
            description: error instanceof Error ? error.message : "The desktop bridge failed.",
            type: "error",
          });
        }
      } finally {
        if (requestSequence === requestSequenceRef.current) {
          pendingSignatureRef.current = null;
          setPending(false);
        }
      }
    },
    [acceptState],
  );

  const disableAllAmbientFeatures = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current;
    const hadLocalMedia = localMedia.source !== null;
    pendingSignatureRef.current = null;
    setPending(true);
    setDisableAllStatus({ message: "Restoring the default appearance...", error: false });
    const outcomes: string[] = [];
    const failures: string[] = [];
    const warnings: string[] = [];
    try {
      // Clear synchronously before the first await. A newer file selected while
      // this operation is pending is a newer user choice and must not be revoked
      // by this older restore request.
      if (hadLocalMedia) {
        try {
          localMediaStore.clear();
          outcomes.push("current local media");
        } catch (error) {
          failures.push(
            error instanceof Error
              ? `Local media: ${error.message}`
              : "The current local media selection could not be cleared.",
          );
        }
      }

      try {
        await updateSettingsAsync({
          fallingEffectsEnabled: false,
          ambientVideoEnabled: false,
          ambientImageEnabled: false,
        });
        outcomes.push("visual effects");
      } catch (error) {
        failures.push(
          error instanceof Error
            ? `Visual effects: ${error.message}`
            : "Visual effects could not be saved.",
        );
      }

      const bridge = window.desktopBridge;
      if (bridge) {
        try {
          const current = stateRef.current ?? (await bridge.getWindowOpacityState());
          if (requestSequence !== requestSequenceRef.current) {
            return;
          }
          if (current.supported) {
            const next = await bridge.setWindowOpacityPreference({
              enabled: false,
              opacity: current.opacity,
            });
            if (requestSequence !== requestSequenceRef.current) {
              return;
            }
            acceptState(next);
            if (isOpaqueWindowState(next)) {
              outcomes.push("window opacity");
              if (next.reason) {
                warnings.push(opacityStatus(next) ?? "The desktop reported a recovery warning.");
              }
            } else {
              failures.push(
                opacityStatus(next) ??
                  "The desktop did not confirm that the window returned to full opacity.",
              );
            }
          }
        } catch (error) {
          failures.push(
            error instanceof Error
              ? `Window opacity: ${error.message}`
              : "The desktop opacity reset failed.",
          );
        }
      }

      const newerLocalMediaActive = localMediaStore.getSnapshot().source !== null;
      const choicesKept = hadLocalMedia
        ? newerLocalMediaActive
          ? "Saved streaming and image sources and choices were kept. The local media selection present when restore began was cleared; a newer selection was kept."
          : "Saved streaming and image sources and choices were kept. The current local media selection was cleared."
        : newerLocalMediaActive
          ? "Saved sources and choices were kept. A newer local media selection remains active."
          : "Saved sources and choices were kept.";
      if (failures.length > 0) {
        const message =
          outcomes.length > 0
            ? "Appearance was only partly restored. Retry the remaining active features."
            : "Appearance could not be restored. Review the error and retry.";
        setDisableAllStatus({ message, error: true });
        toastManager.add({
          title:
            outcomes.length > 0
              ? "Appearance only partly restored"
              : "Appearance could not be restored",
          description: `${failures.join(" ")} ${choicesKept}`,
          type: "error",
        });
      } else if (newerLocalMediaActive) {
        const message =
          "Appearance restore completed. A newer local media selection remains active.";
        setDisableAllStatus({ message, error: false });
        toastManager.add({
          title: "Newer local media kept",
          description: choicesKept,
          type: "warning",
        });
      } else if (warnings.length > 0) {
        const message = "Appearance is restored, but the desktop reported a recovery warning.";
        setDisableAllStatus({ message, error: false });
        toastManager.add({
          title: "Appearance restored with a warning",
          description: `${warnings.join(" ")} ${choicesKept}`,
          type: "warning",
        });
      } else {
        const message = hadLocalMedia
          ? "All available ambient features are off. Saved choices were kept; the current local media selection was cleared."
          : "All available ambient features are off. Saved choices were kept.";
        setDisableAllStatus({ message, error: false });
        toastManager.add({
          title: "Ambient appearance disabled",
          description: `Turned off ${outcomes.join(" and ")}. ${choicesKept}`,
          type: "success",
        });
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        pendingSignatureRef.current = null;
        setPending(false);
      }
    }
  }, [acceptState, localMedia.source, updateSettingsAsync]);

  const supported = state?.supported === true;
  const opacity = opacityDraft;
  const nativeOpacityNeedsRecovery =
    state?.supported === true && (state.enabled === true || state.effectiveOpacity !== 1);
  const ambientActive =
    settings.fallingEffectsEnabled ||
    settings.ambientVideoEnabled ||
    settings.ambientImageEnabled ||
    localMedia.source !== null ||
    nativeOpacityNeedsRecovery;

  return (
    <SettingsSection title="Window transparency and safety">
      <SettingsRow
        title="Transparent desktop window"
        description="Make the entire native Cafe Code window translucent. Lower values can reduce text legibility."
        status={
          opacityLoadFailed
            ? "The current native state is unknown. Restore the window to opaque, then retry."
            : opacityStatus(state)
        }
        control={
          <Switch
            aria-label="Transparent desktop window"
            checked={state?.enabled === true}
            disabled={!supported || pending}
            onCheckedChange={(enabled) => void applyPreference(enabled, opacity)}
          />
        }
      >
        {supported ? (
          <div className="flex items-center gap-3 pb-3 text-xs text-muted-foreground">
            <label className="flex flex-1 items-center gap-3">
              Window opacity
              <input
                aria-label="Desktop window opacity"
                className="min-w-28 flex-1"
                disabled={pending}
                max={MAX_DESKTOP_WINDOW_OPACITY}
                min={MIN_DESKTOP_WINDOW_OPACITY}
                step="0.01"
                type="range"
                value={opacity}
                onChange={(event) => {
                  setOpacityDraft(Number(event.currentTarget.value));
                }}
                onPointerUp={(event) =>
                  void applyPreference(state?.enabled === true, Number(event.currentTarget.value))
                }
                onPointerCancel={(event) =>
                  void applyPreference(state?.enabled === true, Number(event.currentTarget.value))
                }
                onLostPointerCapture={(event) =>
                  void applyPreference(state?.enabled === true, Number(event.currentTarget.value))
                }
                onBlur={(event) =>
                  void applyPreference(state?.enabled === true, Number(event.currentTarget.value))
                }
                onKeyUp={(event) => {
                  if (
                    event.key.startsWith("Arrow") ||
                    event.key === "Home" ||
                    event.key === "End"
                  ) {
                    void applyPreference(
                      state?.enabled === true,
                      Number(event.currentTarget.value),
                    );
                  }
                }}
              />
              {Math.round(opacity * 100)}%
            </label>
            <SettingResetButton
              label="window opacity"
              onClick={() => void applyPreference(false, DEFAULT_DESKTOP_WINDOW_OPACITY)}
            />
          </div>
        ) : opacityLoadFailed ? (
          <div className="pb-3">
            <Button
              disabled={pending}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void applyPreference(false, 1)}
            >
              Restore opaque window
            </Button>
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="Disable all ambient features"
        description="Turn off falling effects, both ambient media panels and their visible glows, native window opacity, and the current local media selection. Saved streaming and image sources remain available."
        status={
          disableAllStatus ? (
            <span
              aria-live={disableAllStatus.error ? "assertive" : "polite"}
              role={disableAllStatus.error ? "alert" : "status"}
            >
              {disableAllStatus.message}
            </span>
          ) : null
        }
        control={
          <Button
            aria-busy={pending}
            disabled={pending || !ambientActive}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void disableAllAmbientFeatures()}
          >
            {pending ? "Restoring..." : "Restore appearance"}
          </Button>
        }
      />
    </SettingsSection>
  );
}
