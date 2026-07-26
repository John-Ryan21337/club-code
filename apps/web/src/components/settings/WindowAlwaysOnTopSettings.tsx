import type { DesktopWindowAlwaysOnTopState } from "@cafecode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

function alwaysOnTopStatus(state: DesktopWindowAlwaysOnTopState | null): string | null {
  if (!state) {
    return "Checking native desktop support...";
  }
  if (!state.supported) {
    return state.reason === "window-manager-dependent"
      ? "Linux—including Arch, Ubuntu/Kubuntu, and Raspberry Pi OS—depends on its X11/Wayland window manager, so Cafe leaves normal stacking unchanged."
      : "This desktop platform does not provide a supported whole-window topmost API.";
  }
  switch (state.reason) {
    case "apply-failed":
      return "Topmost mode could not be applied. The window was restored to normal stacking.";
    case "persistence-failed":
      return "Topmost mode was turned off because the preference could not be saved.";
    case "safe-reset-failed":
      return "Cafe could not confirm normal stacking. Restart the desktop app before retrying.";
    case "native-state-mismatch":
      return "The native window state no longer matches the saved preference. Reset it before retrying.";
    case "native-state-unconfirmed":
      return "Cafe could not confirm one native stacking state across its live windows. Reset it before retrying.";
    default:
      return null;
  }
}

export function WindowAlwaysOnTopSettings() {
  const bridge =
    typeof window === "undefined" ||
    typeof window.desktopBridge?.getWindowAlwaysOnTopState !== "function" ||
    typeof window.desktopBridge.setWindowAlwaysOnTopPreference !== "function"
      ? null
      : window.desktopBridge;
  const [state, setState] = useState<DesktopWindowAlwaysOnTopState | null>(null);
  const [pending, setPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const acceptState = useCallback((next: DesktopWindowAlwaysOnTopState) => {
    setState(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setState(null);
    setLoadFailed(false);
    if (!bridge) {
      return () => {
        mountedRef.current = false;
      };
    }

    const requestSequence = ++requestSequenceRef.current;
    void bridge
      .getWindowAlwaysOnTopState()
      .then((next) => {
        if (mountedRef.current && requestSequence === requestSequenceRef.current) {
          setLoadFailed(false);
          acceptState(next);
        }
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
        setLoadFailed(true);
        toastManager.add({
          title: "Could not read desktop stacking",
          description: error instanceof Error ? error.message : "The desktop bridge failed.",
          type: "error",
        });
      });

    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
    };
  }, [acceptState, bridge]);

  const applyPreference = useCallback(
    async (enabled: boolean) => {
      if (!bridge || inFlightRef.current || state?.supported !== true) {
        return;
      }
      const requestSequence = ++requestSequenceRef.current;
      inFlightRef.current = true;
      setPending(true);
      try {
        const next = await bridge.setWindowAlwaysOnTopPreference({ enabled });
        if (mountedRef.current && requestSequence === requestSequenceRef.current) {
          acceptState(next);
        }
      } catch (error: unknown) {
        if (mountedRef.current && requestSequence === requestSequenceRef.current) {
          try {
            const recovered = await bridge.getWindowAlwaysOnTopState();
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
              setLoadFailed(false);
              acceptState(recovered);
            }
          } catch {
            if (mountedRef.current && requestSequence === requestSequenceRef.current) {
              setState(null);
              setLoadFailed(true);
            }
          }
        }
        if (mountedRef.current && requestSequence === requestSequenceRef.current) {
          toastManager.add({
            title: "Could not change desktop stacking",
            description: error instanceof Error ? error.message : "The desktop bridge failed.",
            type: "error",
          });
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current && requestSequence === requestSequenceRef.current) {
          setPending(false);
        }
      }
    },
    [acceptState, bridge, state?.supported],
  );

  // Remote web and ordinary browser sessions do not expose this native control.
  if (!bridge) {
    return null;
  }

  const status = loadFailed
    ? "The current native stacking state is unknown. Restart the desktop app before retrying."
    : alwaysOnTopStatus(state);
  const supported = state?.supported === true;

  return (
    <SettingsSection title="Native desktop stacking">
      <SettingsRow
        title="Keep whole desktop window above other applications"
        description="Keeps the entire Cafe Code desktop window above other applications on Windows 10/11 and macOS. This is separate from any in-app media stacking, and it does not detach or make only a video topmost."
        status={status}
        resetAction={
          state && (state.enabled || state.effectiveEnabled !== false) ? (
            <SettingResetButton
              label="whole-window always-on-top"
              onClick={() => void applyPreference(false)}
            />
          ) : null
        }
        control={
          <Switch
            aria-label="Keep whole Cafe Code desktop window above other applications"
            checked={state?.enabled === true}
            disabled={
              !supported ||
              pending ||
              loadFailed ||
              state?.effectiveEnabled === null ||
              state?.reason === "native-state-mismatch"
            }
            onCheckedChange={(enabled) => void applyPreference(enabled)}
          />
        }
      />
    </SettingsSection>
  );
}
