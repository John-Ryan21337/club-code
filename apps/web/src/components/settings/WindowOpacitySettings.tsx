import {
  DEFAULT_DESKTOP_WINDOW_OPACITY,
  MAX_DESKTOP_WINDOW_OPACITY,
  MIN_DESKTOP_WINDOW_OPACITY,
  type DesktopWindowOpacityState,
} from "@cafecode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

/**
 * Whole-window opacity is a native BrowserWindow capability. The renderer never
 * fakes it with CSS, because CSS cannot make the window frame or the area
 * behind the app translucent, and a faked value would misreport the real
 * native state that recovery depends on.
 */
export function windowOpacityStatus(state: DesktopWindowOpacityState | null): string | null {
  if (typeof window === "undefined" || !window.desktopBridge) {
    return "Whole-window opacity is available only in the desktop app.";
  }
  if (!state) {
    return "Checking desktop support...";
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

export function WindowOpacitySettings() {
  const [state, setState] = useState<DesktopWindowOpacityState | null>(null);
  const [opacityDraft, setOpacityDraft] = useState(DEFAULT_DESKTOP_WINDOW_OPACITY);
  const [pending, setPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
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
          setLoadFailed(false);
          acceptState(next);
        }
      })
      .catch((error: unknown) => {
        if (!active || requestSequence !== requestSequenceRef.current) return;
        setLoadFailed(true);
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
      // Pointer, keyboard and blur handlers all report the same slider value.
      // Dropping the duplicate keeps one native write per distinct choice.
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
          setLoadFailed(false);
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

  const supported = state?.supported === true;

  return (
    <SettingsRow
      title="Transparent desktop window"
      description="Make the whole native Cafe Code window translucent. Lower values reduce text legibility."
      status={
        loadFailed
          ? "The current native state is unknown. Restore the window to opaque, then retry."
          : windowOpacityStatus(state)
      }
      control={
        <Switch
          aria-label="Transparent desktop window"
          checked={state?.enabled === true}
          disabled={!supported || pending}
          onCheckedChange={(checked) => void applyPreference(Boolean(checked), opacityDraft)}
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
              value={opacityDraft}
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
                if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                  void applyPreference(state?.enabled === true, Number(event.currentTarget.value));
                }
              }}
            />
            {Math.round(opacityDraft * 100)}%
          </label>
          <SettingResetButton
            label="window opacity"
            onClick={() => void applyPreference(false, DEFAULT_DESKTOP_WINDOW_OPACITY)}
          />
        </div>
      ) : loadFailed ? (
        <div className="pb-3">
          <Button
            disabled={pending}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void applyPreference(false, MAX_DESKTOP_WINDOW_OPACITY)}
          >
            Restore opaque window
          </Button>
        </div>
      ) : null}
    </SettingsRow>
  );
}
