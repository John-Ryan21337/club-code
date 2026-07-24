import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DesktopLocalMediaCapability } from "@cafecode/contracts";

import {
  LOCAL_MEDIA_INPUT_ACCEPT,
  MAX_LOCAL_MEDIA_VISUALIZER_BLEND_SECONDS,
  MAX_LOCAL_MEDIA_VISUALIZER_CYCLE_SECONDS,
  MIN_LOCAL_MEDIA_VISUALIZER_BLEND_SECONDS,
  MIN_LOCAL_MEDIA_VISUALIZER_CYCLE_SECONDS,
  localMediaStore,
  useLocalMediaState,
} from "../../localMedia";
import {
  adjacentMilkdropPresetName,
  loadMilkdropPresetNames,
  randomMilkdropPresetName,
} from "../../milkdropVisualizer";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function LocalMediaSettings() {
  const state = useLocalMediaState();
  const desktopBridgeAvailable =
    typeof window !== "undefined" && window.desktopBridge !== undefined;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [desktopCapability, setDesktopCapability] = useState<DesktopLocalMediaCapability | null>(
    null,
  );
  const [desktopCapabilityLoading, setDesktopCapabilityLoading] = useState(false);
  const [desktopSelectionLoading, setDesktopSelectionLoading] = useState(false);
  const desktopSelectionInFlightRef = useRef(false);
  const [presetNames, setPresetNames] = useState<readonly string[]>([]);
  const [presetCatalogStatus, setPresetCatalogStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [presetQuery, setPresetQuery] = useState(state.visualizerPresetName ?? "");

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
    if (!bridge) {
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
        setSelectionError("VLC returned an invalid local media session.");
        return;
      }
      if (localMediaStore.getSelectionRevision() !== selectionRevision) {
        // A newer browser-file choice or Clear action won while the native
        // picker was open. Release the now-stale VLC process instead of
        // overwriting the operator's newer intent.
        await bridge.releaseLocalMedia({ sessionId: selection.sessionId }).catch(() => undefined);
        return;
      }
      if (!localMediaStore.selectDesktopMedia(selection)) {
        await bridge.releaseLocalMedia({ sessionId: selection.sessionId }).catch(() => undefined);
        setSelectionError("VLC returned an invalid local media session.");
      }
    } catch {
      setSelectionError("VLC could not open the selected media file.");
    } finally {
      desktopSelectionInFlightRef.current = false;
      setDesktopSelectionLoading(false);
    }
  }, []);

  useEffect(() => {
    setPresetQuery(state.visualizerPresetName ?? "");
  }, [state.visualizerPresetName]);

  useEffect(() => {
    const shouldLoadCatalog =
      state.source !== null && state.visualizerEnabled && state.visualizerStyle === "milkdrop";
    if (!shouldLoadCatalog || presetNames.length > 0) {
      return;
    }
    let cancelled = false;
    setPresetCatalogStatus("loading");
    void loadMilkdropPresetNames().then(
      (names) => {
        if (cancelled) return;
        setPresetNames(names);
        setPresetCatalogStatus("ready");
      },
      () => {
        if (!cancelled) setPresetCatalogStatus("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [presetNames.length, state.source, state.visualizerEnabled, state.visualizerStyle]);

  const hasSource = state.source !== null;
  const milkdropControlsEnabled =
    hasSource &&
    state.visualizerEnabled &&
    state.visualizerStyle === "milkdrop" &&
    presetCatalogStatus === "ready";

  const selectPreset = useCallback((name: string | null) => {
    localMediaStore.update({ visualizerPresetName: name });
    setPresetQuery(name ?? "");
  }, []);

  const navigatePreset = useCallback(
    (direction: -1 | 1) => {
      selectPreset(adjacentMilkdropPresetName(presetNames, state.visualizerPresetName, direction));
    },
    [presetNames, selectPreset, state.visualizerPresetName],
  );

  return (
    <SettingsSection title="Local Media">
      <SettingsRow
        title="Choose local media"
        description="Choose a session-only queue of up to 64 audio or video files (64 GiB total). Direct playback uses the browser; Open with VLC supports formats such as FLV, MKV, AVI, WMA, and transport streams. Club Code keeps native paths out of renderer state, logs, and settings."
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
          <div className="flex items-center gap-2">
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
        description="Floating overlays the chat, Cinema keeps the project sidebar and moves chat into a right rail, and Video background lets chat remain readable over a pass-through video veil."
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

      <SettingsRow
        title="Audio visualizer"
        description="MilkDrop renders a locally bundled library of hundreds of reactive styles; Spectrum is the quieter classic view. Both directly analyse this session's selected browser or VLC media element. YouTube and Spotify require the separate, explicit shared-audio control; there is never a microphone fallback."
        control={
          <Switch
            aria-label="Enable local media audio visualizer"
            checked={state.visualizerEnabled}
            disabled={!hasSource}
            onCheckedChange={(visualizerEnabled) => localMediaStore.update({ visualizerEnabled })}
          />
        }
        status={
          <span>
            Rapid motion and flashing imagery can affect photosensitive viewers. The visualizer
            pauses when reduced motion is requested, the window loses focus, or the document is
            hidden.
          </span>
        }
      >
        <div className="grid gap-4 py-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Style
            <Select
              disabled={!hasSource || !state.visualizerEnabled}
              value={state.visualizerStyle}
              onValueChange={(value) => {
                if (value === "milkdrop" || value === "spectrum") {
                  localMediaStore.update({ visualizerStyle: value });
                }
              }}
            >
              <SelectTrigger aria-label="Local media visualizer style">
                <SelectValue>
                  {state.visualizerStyle === "milkdrop"
                    ? "MilkDrop · bundled presets"
                    : "Spectrum · classic bars"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="milkdrop">
                  MilkDrop · bundled presets
                </SelectItem>
                <SelectItem hideIndicator value="spectrum">
                  Spectrum · classic bars
                </SelectItem>
              </SelectPopup>
            </Select>
          </label>

          {state.visualizerStyle === "milkdrop" ? (
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Search or browse preset
              <input
                aria-label="MilkDrop preset"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!milkdropControlsEnabled}
                list="local-media-milkdrop-presets"
                placeholder={
                  presetCatalogStatus === "error"
                    ? "Preset catalog unavailable"
                    : presetCatalogStatus === "ready"
                      ? `${presetNames.length} bundled presets`
                      : "Loading bundled presets…"
                }
                value={presetQuery}
                onBlur={() => setPresetQuery(state.visualizerPresetName ?? "")}
                onChange={(event) => {
                  const query = event.currentTarget.value;
                  setPresetQuery(query);
                  if (presetNames.includes(query)) {
                    localMediaStore.update({ visualizerPresetName: query });
                  }
                }}
              />
              <datalist id="local-media-milkdrop-presets">
                {presetNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
          ) : null}
        </div>

        {state.visualizerStyle === "milkdrop" ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 py-3">
            <Button
              size="xs"
              type="button"
              variant="outline"
              disabled={!milkdropControlsEnabled}
              onClick={() => navigatePreset(-1)}
            >
              Previous preset
            </Button>
            <Button
              size="xs"
              type="button"
              variant="outline"
              disabled={!milkdropControlsEnabled}
              onClick={() =>
                selectPreset(randomMilkdropPresetName(presetNames, state.visualizerPresetName))
              }
            >
              Surprise me
            </Button>
            <Button
              size="xs"
              type="button"
              variant="outline"
              disabled={!milkdropControlsEnabled}
              onClick={() => navigatePreset(1)}
            >
              Next preset
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {presetCatalogStatus === "ready"
                ? `${presetNames.length} bundled presets, loaded locally`
                : presetCatalogStatus === "error"
                  ? "The bundled preset catalog could not be loaded."
                  : "The preset catalog loads only when MilkDrop is enabled."}
            </span>
          </div>
        ) : null}

        {state.visualizerStyle === "milkdrop" ? (
          <div className="grid gap-4 border-t border-border/60 py-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-xs text-muted-foreground">
              Auto-cycle
              <Switch
                aria-label="Auto-cycle MilkDrop presets"
                checked={state.visualizerAutoCycle}
                disabled={!hasSource || !state.visualizerEnabled}
                onCheckedChange={(visualizerAutoCycle) =>
                  localMediaStore.update({ visualizerAutoCycle })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Change every
              <input
                aria-label="MilkDrop auto-cycle interval"
                className="w-28 accent-primary"
                disabled={!hasSource || !state.visualizerEnabled || !state.visualizerAutoCycle}
                max={MAX_LOCAL_MEDIA_VISUALIZER_CYCLE_SECONDS}
                min={MIN_LOCAL_MEDIA_VISUALIZER_CYCLE_SECONDS}
                step="5"
                type="range"
                value={state.visualizerCycleSeconds}
                onChange={(event) =>
                  localMediaStore.update({
                    visualizerCycleSeconds: Number(event.currentTarget.value),
                  })
                }
              />
              <span className="w-10 tabular-nums">{state.visualizerCycleSeconds}s</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
              Preset blend
              <input
                aria-label="MilkDrop preset blend duration"
                className="w-32 accent-primary"
                disabled={!hasSource || !state.visualizerEnabled}
                max={MAX_LOCAL_MEDIA_VISUALIZER_BLEND_SECONDS}
                min={MIN_LOCAL_MEDIA_VISUALIZER_BLEND_SECONDS}
                step="0.5"
                type="range"
                value={state.visualizerBlendSeconds}
                onChange={(event) =>
                  localMediaStore.update({
                    visualizerBlendSeconds: Number(event.currentTarget.value),
                  })
                }
              />
              <span className="w-10 tabular-nums">{state.visualizerBlendSeconds}s</span>
            </label>
          </div>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  );
}
