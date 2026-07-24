import { type ChangeEvent, useCallback, useRef, useState } from "react";

import { LOCAL_MEDIA_INPUT_ACCEPT, localMediaStore, useLocalMediaState } from "../../localMedia";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function LocalMediaSettings() {
  const state = useLocalMediaState();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const chooseFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.item(0) ?? null;
    // Allow choosing the same file again after clearing it. The File never enters
    // state; only the browser's current-document object URL does.
    event.currentTarget.value = "";
    if (!file) return;
    if (!localMediaStore.selectFile(file)) {
      setSelectionError("Choose a supported audio or video file.");
      return;
    }
    setSelectionError(null);
  }, []);

  const hasSource = state.source !== null;

  return (
    <SettingsSection title="Local Media">
      <SettingsRow
        title="Choose local media"
        description="Play one audio or video file in the chat area. Browser playback depends on browser support; VLC-format fallback is available only in the desktop app. No file path or contents are stored or sent to Cafe Code."
        status={
          selectionError ? (
            <span role="alert" className="text-destructive">
              {selectionError}
            </span>
          ) : (
            <span>
              {hasSource
                ? `Current: ${state.source.displayTitle}. This title is session-only and ends when you clear it or refresh.`
                : "No media selected. Any title is session-only and ends when you clear it or refresh."}
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
              onChange={chooseFile}
            />
            <Button
              size="xs"
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </Button>
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
        description="Add a soft, local visual glow around the media player."
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
            Color
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
        description="A bounded spectrum display for this selected local file only. It never captures YouTube, Spotify, system audio, a microphone, or another app."
        control={
          <Switch
            aria-label="Enable local media audio visualizer"
            checked={state.visualizerEnabled}
            disabled={!hasSource}
            onCheckedChange={(visualizerEnabled) => localMediaStore.update({ visualizerEnabled })}
          />
        }
      />
    </SettingsSection>
  );
}
