import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DesktopLocalMediaCapability } from "@cafecode/contracts";

import { LOCAL_MEDIA_INPUT_ACCEPT, localMediaStore, useLocalMediaState } from "../../localMedia";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function LocalMediaSettings() {
  const state = useLocalMediaState();
  const desktopBridgeAvailable =
    typeof window !== "undefined" &&
    typeof window.desktopBridge?.pickLocalMedia === "function" &&
    typeof window.desktopBridge?.getLocalMediaCapability === "function";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [desktopCapability, setDesktopCapability] = useState<DesktopLocalMediaCapability | null>(
    null,
  );
  const [desktopCapabilityLoading, setDesktopCapabilityLoading] = useState(false);
  const [desktopSelectionLoading, setDesktopSelectionLoading] = useState(false);
  const desktopSelectionInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const chooseFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files ? [...event.currentTarget.files] : [];
    // Allow choosing the same file again after clearing it. The File never enters
    // state; only the browser's current-document object URL does.
    event.currentTarget.value = "";
    if (files.length === 0) return;
    if (!localMediaStore.selectFiles(files)) {
      setSelectionError("Choose up to 64 supported audio or video files (64 GiB total).");
      return;
    }
    setSelectionError(null);
  }, []);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.getLocalMediaCapability !== "function") {
      setDesktopCapability(null);
      return;
    }
    let cancelled = false;
    setDesktopCapabilityLoading(true);
    void bridge.getLocalMediaCapability().then(
      (capability) => {
        if (!cancelled) {
          setDesktopCapability(capability);
          setDesktopCapabilityLoading(false);
        }
      },
      () => {
        if (!cancelled) {
          setDesktopCapability({
            available: false,
            engine: {
              label: "VLC",
              version: null,
              reason: "VLC availability could not be checked.",
            },
          });
          setDesktopCapabilityLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseWithVlc = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge || desktopSelectionInFlightRef.current) {
      return;
    }
    desktopSelectionInFlightRef.current = true;
    const selectionRevision = localMediaStore.getSelectionRevision();
    setDesktopSelectionLoading(true);
    setSelectionError(null);
    try {
      const selection = await bridge.pickLocalMedia();
      if (selection === null) {
        return;
      }
      if (!selection || typeof selection.sessionId !== "string") {
        if (mountedRef.current) setSelectionError("VLC returned an invalid local media session.");
        return;
      }
      if (!mountedRef.current || localMediaStore.getSelectionRevision() !== selectionRevision) {
        // A closed settings view, newer file choice or Clear action invalidates
        // this pending picker. Release its native session without replacing
        // the queue that the current workspace owns.
        await bridge.releaseLocalMedia({ sessionId: selection.sessionId }).catch(() => undefined);
        return;
      }
      if (!localMediaStore.selectDesktopMedia(selection)) {
        await bridge.releaseLocalMedia({ sessionId: selection.sessionId }).catch(() => undefined);
        if (mountedRef.current) setSelectionError("VLC returned an invalid local media session.");
      }
    } catch {
      if (mountedRef.current) setSelectionError("VLC could not open the selected media file.");
    } finally {
      desktopSelectionInFlightRef.current = false;
      if (mountedRef.current) setDesktopSelectionLoading(false);
    }
  }, []);

  const hasSource = state.source !== null;

  return (
    <SettingsSection title="Local Media">
      <SettingsRow
        title="Choose local media"
        description="Choose up to 64 audio or video files (64 GiB total). Direct queue uses the browser. Open with VLC supports additional formats. Return to chat to see the player. Files and playback choices are not saved."
        status={
          selectionError ? (
            <span role="alert" className="text-destructive">
              {selectionError}
            </span>
          ) : (
            <span>
              {hasSource
                ? `Current: ${state.source.displayTitle} (${(state.queue?.currentIndex ?? 0) + 1}/${state.queue?.totalItems ?? 1}) via ${state.source.engine === "vlc" ? "VLC" : "browser"}. This queue is session-only and ends when you clear it or refresh.`
                : "No media selected. Any title is session-only and ends when you clear it or refresh."}
              {!hasSource && desktopCapability?.available === false
                ? ` VLC is unavailable: ${desktopCapability.engine.reason ?? "not installed."}`
                : ""}
            </span>
          )
        }
        control={
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              aria-label="Choose local audio or video"
              className="sr-only"
              type="file"
              accept={LOCAL_MEDIA_INPUT_ACCEPT}
              multiple
              onChange={chooseFile}
            />
            <Button
              size="xs"
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Direct queue
            </Button>
            {desktopBridgeAvailable ? (
              <Button
                disabled={
                  desktopCapabilityLoading ||
                  desktopSelectionLoading ||
                  desktopCapability?.available !== true
                }
                size="xs"
                type="button"
                variant="outline"
                onClick={() => void chooseWithVlc()}
              >
                {desktopSelectionLoading
                  ? "Opening…"
                  : desktopCapabilityLoading
                    ? "Checking VLC…"
                    : "VLC queue"}
              </Button>
            ) : null}
            {hasSource ? (
              <Button
                size="xs"
                type="button"
                variant="ghost"
                onClick={() => {
                  localMediaStore.clear();
                  setSelectionError(null);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        }
      />

      <SettingsRow
        title="Presentation"
        description="Floating places the player over chat. Cinema places the player beside chat. Video background places the video behind readable chat surfaces."
        control={
          <Select
            disabled={!hasSource}
            value={state.presentationMode}
            onValueChange={(value) => {
              if (
                value === "floating" ||
                value === "cinema" ||
                (value === "background" && state.source?.kind === "video")
              ) {
                localMediaStore.update({ presentationMode: value });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Local media presentation">
              <SelectValue>
                {state.presentationMode === "cinema"
                  ? "Cinema + chat rail"
                  : state.presentationMode === "background"
                    ? "Video background"
                    : "Floating"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="floating">
                Floating
              </SelectItem>
              <SelectItem hideIndicator value="cinema">
                Cinema + chat rail
              </SelectItem>
              {state.source?.kind === "video" ? (
                <SelectItem hideIndicator value="background">
                  Video background
                </SelectItem>
              ) : null}
            </SelectPopup>
          </Select>
        }
      >
        {state.presentationMode === "background" && state.source?.kind === "video" ? (
          <label className="flex items-center gap-3 py-3 text-xs text-muted-foreground">
            Video veil
            <input
              aria-label="Local media background opacity"
              className="w-36 accent-primary"
              max="0.7"
              min="0.15"
              step="0.05"
              type="range"
              value={state.backgroundOpacity}
              onChange={(event) =>
                localMediaStore.update({
                  backgroundOpacity: Number(event.currentTarget.value),
                })
              }
            />
            <span className="w-8 tabular-nums">{Math.round(state.backgroundOpacity * 100)}%</span>
          </label>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="Floating layout"
        description="Preset keeps the player in a lower corner. Custom enables mouse drag, resize, and keyboard adjustments on the player itself."
        control={
          <Select
            disabled={!hasSource || state.presentationMode !== "floating"}
            value={state.layoutMode}
            onValueChange={(value) => {
              if (value === "preset" || value === "custom") {
                localMediaStore.update({ layoutMode: value });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-40" aria-label="Local media layout">
              <SelectValue>{state.layoutMode === "preset" ? "Preset" : "Custom"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="preset">
                Preset
              </SelectItem>
              <SelectItem hideIndicator value="custom">
                Custom
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />

      <SettingsRow
        title="Preset position"
        description="Applies while the floating layout is set to Preset."
        control={
          <div className="flex gap-2">
            <Select
              disabled={
                !hasSource || state.presentationMode !== "floating" || state.layoutMode !== "preset"
              }
              value={state.presetPlacement}
              onValueChange={(value) => {
                if (value === "bottom-left" || value === "bottom-right") {
                  localMediaStore.update({ presetPlacement: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Local media corner">
                <SelectValue>
                  {state.presetPlacement === "bottom-left" ? "Bottom left" : "Bottom right"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="bottom-left">
                  Bottom left
                </SelectItem>
                <SelectItem hideIndicator value="bottom-right">
                  Bottom right
                </SelectItem>
              </SelectPopup>
            </Select>
            <Select
              disabled={
                !hasSource || state.presentationMode !== "floating" || state.layoutMode !== "preset"
              }
              value={state.presetSize}
              onValueChange={(value) => {
                if (value === "small" || value === "medium" || value === "large") {
                  localMediaStore.update({ presetSize: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-28" aria-label="Local media size">
                <SelectValue>{state.presetSize}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="small">
                  Small
                </SelectItem>
                <SelectItem hideIndicator value="medium">
                  Medium
                </SelectItem>
                <SelectItem hideIndicator value="large">
                  Large
                </SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        title="Player glow"
        description="Use one fixed color, or sample a tiny current frame from an approved direct/VLC video for bounded Ambilight-style edge colors. Unsupported or unavailable frames fall back to the fixed color."
        control={
          <Switch
            aria-label="Enable local media glow"
            checked={state.glowEnabled}
            disabled={!hasSource || state.presentationMode === "background"}
            onCheckedChange={(glowEnabled) => localMediaStore.update({ glowEnabled })}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-3 py-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Mode
            <select
              aria-label="Local media glow mode"
              className="h-8 rounded border border-input bg-background px-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !hasSource ||
                !state.glowEnabled ||
                state.source?.kind !== "video" ||
                state.presentationMode === "background"
              }
              value={state.glowMode}
              onChange={(event) => {
                const glowMode = event.currentTarget.value;
                if (glowMode === "fixed" || glowMode === "adaptive") {
                  localMediaStore.update({ glowMode });
                }
              }}
            >
              <option value="fixed">Fixed</option>
              <option value="adaptive">Adaptive video edges</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {state.glowMode === "adaptive" ? "Fallback" : "Color"}
            <input
              aria-label="Local media glow color"
              className="h-8 w-12 cursor-pointer rounded border border-input bg-transparent p-1 disabled:cursor-not-allowed"
              disabled={!hasSource || !state.glowEnabled || state.presentationMode === "background"}
              type="color"
              value={state.glowColor}
              onChange={(event) => localMediaStore.update({ glowColor: event.currentTarget.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Opacity
            <input
              aria-label="Local media glow opacity"
              className="w-32 accent-primary"
              disabled={!hasSource || !state.glowEnabled || state.presentationMode === "background"}
              max="1"
              min="0"
              step="0.05"
              type="range"
              value={state.glowOpacity}
              onChange={(event) =>
                localMediaStore.update({ glowOpacity: Number(event.currentTarget.value) })
              }
            />
            <span className="w-8 tabular-nums">{Math.round(state.glowOpacity * 100)}%</span>
          </label>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
