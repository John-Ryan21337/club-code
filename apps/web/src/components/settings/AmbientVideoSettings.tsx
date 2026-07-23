import {
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_AMBIENT_VIDEO_ENABLED,
  DEFAULT_AMBIENT_VIDEO_GLOW_ENABLED,
  DEFAULT_AMBIENT_VIDEO_LAYOUT_MODE,
  DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
  DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
  DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
  DEFAULT_AMBIENT_VIDEO_SOURCE,
} from "@cafecode/contracts/settings";
import { ExternalLinkIcon, LoaderIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { parseYouTubeSource, youtubeSourceInputValue } from "../../ambientVideo";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { useServerConfig } from "../../rpc/serverState";
import {
  isYouTubeDiscoveryAbort,
  searchYouTube,
  type YouTubeDiscoveryResult,
  YouTubeDiscoveryError,
} from "../../youtubeDiscovery";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const DEFAULT_GLOW_PICKER_COLOR = "#7dd3fc";

async function openYouTubeUrl(url: string): Promise<void> {
  try {
    await ensureLocalApi().shell.openExternal(url);
  } catch (error) {
    toastManager.add({
      title: "Could not open YouTube",
      description:
        error instanceof Error ? error.message : "The external link could not be opened.",
      type: "error",
    });
  }
}

export function AmbientVideoSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverConfig = useServerConfig();
  const [sourceDraft, setSourceDraft] = useState(() =>
    youtubeSourceInputValue(settings.ambientVideoSource),
  );
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchResults, setSearchResults] = useState<readonly YouTubeDiscoveryResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchPending, setSearchPending] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const playerAvailable = serverConfig?.ambientExperienceCapabilities.youtubePlayer === true;
  const publicDiscoveryAvailable =
    serverConfig?.ambientExperienceCapabilities.youtubePublicDiscovery === true;

  useEffect(() => {
    setSourceDraft(youtubeSourceInputValue(settings.ambientVideoSource));
  }, [settings.ambientVideoSource]);

  useEffect(
    () => () => {
      const controller = searchAbortRef.current;
      searchAbortRef.current = null;
      controller?.abort();
    },
    [],
  );

  const applySource = useCallback(() => {
    const trimmed = sourceDraft.trim();
    const source = parseYouTubeSource(trimmed);
    if (trimmed.length > 0 && source === null) {
      setSourceError("Enter a supported YouTube video, playlist URL, or 11-character video ID.");
      return;
    }
    setSourceError(null);
    updateSettings({
      ambientVideoSource: source,
      ambientVideoEnabled: source === null ? settings.ambientVideoEnabled : true,
    });
  }, [settings.ambientVideoEnabled, sourceDraft, updateSettings]);

  const openExternalSearch = useCallback(() => {
    const query = searchDraft.trim();
    if (!query) {
      return;
    }
    void openYouTubeUrl(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    );
  }, [searchDraft]);

  const runSearch = useCallback(async () => {
    const query = searchDraft.trim();
    if (!query) {
      return;
    }
    if (!publicDiscoveryAvailable) {
      openExternalSearch();
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchPending(true);
    setSearchAttempted(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      setSearchResults(await searchYouTube(query, { signal: controller.signal }));
    } catch (error) {
      if (isYouTubeDiscoveryAbort(error)) {
        return;
      }
      setSearchError(
        error instanceof YouTubeDiscoveryError
          ? error.message
          : "YouTube search could not be reached.",
      );
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setSearchPending(false);
      }
    }
  }, [openExternalSearch, publicDiscoveryAvailable, searchDraft]);

  const chooseSearchResult = useCallback(
    (result: YouTubeDiscoveryResult) => {
      const source = { kind: result.kind, id: result.id } as const;
      setSourceDraft(youtubeSourceInputValue(source));
      setSourceError(null);
      updateSettings({
        ambientVideoSource: source,
        ambientVideoEnabled: true,
      });
    },
    [updateSettings],
  );

  return (
    <SettingsSection title="Ambient YouTube">
      <SettingsRow
        title="Show video"
        description="Play one YouTube video or playlist in the chat area. Playback stays inside YouTube's privacy-enhanced embedded player."
        status={
          playerAvailable ? null : (
            <span className="text-amber-600 dark:text-amber-400">
              This server has not enabled the YouTube player capability.
            </span>
          )
        }
        control={
          <Switch
            aria-label="Show ambient YouTube video"
            checked={settings.ambientVideoEnabled}
            disabled={!playerAvailable}
            onCheckedChange={(ambientVideoEnabled) => updateSettings({ ambientVideoEnabled })}
          />
        }
      />

      <SettingsRow
        title="Video or playlist"
        description="Paste a YouTube URL or video ID. Cafe Code stores only the validated video or playlist ID."
        status={sourceError ? <span className="text-destructive">{sourceError}</span> : null}
        control={
          <div className="flex w-full max-w-md items-center gap-2">
            <input
              aria-label="YouTube video or playlist"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="YouTube URL, playlist URL, or video ID"
              type="url"
              value={sourceDraft}
              onChange={(event) => {
                setSourceDraft(event.currentTarget.value);
                setSourceError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applySource();
                }
              }}
            />
            <Button size="xs" type="button" variant="outline" onClick={applySource}>
              Apply
            </Button>
            {settings.ambientVideoSource ? (
              <Button
                size="xs"
                type="button"
                variant="ghost"
                onClick={() => {
                  setSourceDraft("");
                  setSourceError(null);
                  updateSettings({
                    ambientVideoEnabled: false,
                    ambientVideoSource: null,
                  });
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        }
      />

      <SettingsRow
        title="Search YouTube"
        description="Search public videos and playlists without connecting an account. Cafe Code sends the query only to its configured YouTube Data API service."
        status={
          searchError ? (
            <span className="text-destructive">{searchError}</span>
          ) : publicDiscoveryAvailable ? null : (
            <span className="text-muted-foreground">
              In-app discovery is disabled; external YouTube search remains available.
            </span>
          )
        }
        control={
          <form
            className="flex w-full max-w-md items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <input
              aria-label="Search YouTube"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Search videos and public playlists"
              type="search"
              maxLength={120}
              disabled={searchPending}
              value={searchDraft}
              onChange={(event) => {
                setSearchDraft(event.currentTarget.value);
                setSearchError(null);
                setSearchAttempted(false);
                setSearchResults([]);
              }}
            />
            <Button
              disabled={searchPending || !searchDraft.trim()}
              size="xs"
              type="submit"
              variant="outline"
            >
              {searchPending ? (
                <LoaderIcon aria-hidden="true" className="size-3.5 animate-spin" />
              ) : publicDiscoveryAvailable ? (
                <SearchIcon aria-hidden="true" className="size-3.5" />
              ) : (
                <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              )}
              {publicDiscoveryAvailable ? "Search" : "Search YouTube"}
            </Button>
          </form>
        }
      >
        {publicDiscoveryAvailable && searchResults.length > 0 ? (
          <ul aria-label="YouTube search results" className="grid gap-1.5 pb-3">
            {searchResults.map((result) => (
              <li key={`${result.kind}:${result.id}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-muted/25 px-2.5 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => chooseSearchResult(result)}
                >
                  <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-medium capitalize text-muted-foreground">
                    {result.kind}
                  </span>
                  <span className="min-w-0 truncate">{result.title}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">Use</span>
                </button>
              </li>
            ))}
          </ul>
        ) : publicDiscoveryAvailable &&
          !searchPending &&
          searchError === null &&
          searchAttempted &&
          searchResults.length === 0 ? (
          <p className="pb-3 text-xs text-muted-foreground">
            No selectable public videos or playlists were returned.
          </p>
        ) : null}
        {publicDiscoveryAvailable ? (
          <Button
            size="xs"
            type="button"
            variant="ghost"
            onClick={openExternalSearch}
            disabled={!searchDraft.trim()}
          >
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            Open this search on YouTube
          </Button>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="Your YouTube playlists"
        description="Open YouTube in your browser using its normal account sign-in, then paste an embeddable playlist URL above. Cafe Code never asks for your YouTube password or Premium status."
        control={
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => void openYouTubeUrl("https://www.youtube.com/feed/playlists")}
          >
            <ExternalLinkIcon className="size-3.5" />
            Open playlists
          </Button>
        }
      />

      <SettingsRow
        title="Presentation"
        description="Floating keeps video over the message pane. Cinema keeps projects on the left, video in the center, and chat in a right rail."
        control={
          <Select
            value={settings.ambientVideoPresentationMode}
            onValueChange={(value) => {
              if (value === "floating" || value === "cinema") {
                updateSettings({ ambientVideoPresentationMode: value });
              }
            }}
          >
            <SelectTrigger aria-label="Ambient video presentation" className="w-40">
              <SelectValue>
                {settings.ambientVideoPresentationMode === "cinema"
                  ? "Cinema workspace"
                  : "Floating"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="floating">
                Floating
              </SelectItem>
              <SelectItem hideIndicator value="cinema">
                Cinema workspace
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />

      <SettingsRow
        title="Floating layout"
        description="Preset uses a comfortable corner size. Custom lets you drag and resize using the player handles."
        control={
          <Select
            value={settings.ambientVideoLayoutMode}
            onValueChange={(value) => {
              if (value === "preset" || value === "custom") {
                updateSettings({ ambientVideoLayoutMode: value });
              }
            }}
          >
            <SelectTrigger aria-label="Ambient video layout" className="w-32">
              <SelectValue>
                {settings.ambientVideoLayoutMode === "custom" ? "Custom" : "Preset"}
              </SelectValue>
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
        title="Floating corner"
        description="Choose which lower corner holds the preset player."
        control={
          <Select
            value={settings.ambientVideoPresetPlacement}
            onValueChange={(value) => {
              if (value === "bottom-left" || value === "bottom-right") {
                updateSettings({ ambientVideoPresetPlacement: value });
              }
            }}
          >
            <SelectTrigger aria-label="Ambient video corner" className="w-36">
              <SelectValue>
                {settings.ambientVideoPresetPlacement === "bottom-left"
                  ? "Bottom left"
                  : "Bottom right"}
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
        }
      />

      <SettingsRow
        title="Floating size"
        description="Small is 360 px, medium 480 px, and large 640 px before responsive clamping."
        control={
          <Select
            value={settings.ambientVideoPresetSize}
            onValueChange={(value) => {
              if (value === "small" || value === "medium" || value === "large") {
                updateSettings({ ambientVideoPresetSize: value });
              }
            }}
          >
            <SelectTrigger aria-label="Ambient video size" className="w-28">
              <SelectValue>
                {settings.ambientVideoPresetSize[0]?.toUpperCase()}
                {settings.ambientVideoPresetSize.slice(1)}
              </SelectValue>
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
        }
      />

      <SettingsRow
        title="Ambient glow"
        description="Add a soft, fading color around the player edge."
        control={
          <Switch
            aria-label="Ambient video glow"
            checked={settings.ambientVideoGlowEnabled}
            onCheckedChange={(ambientVideoGlowEnabled) =>
              updateSettings({ ambientVideoGlowEnabled })
            }
          />
        }
      >
        {settings.ambientVideoGlowEnabled ? (
          <div className="flex flex-wrap items-center gap-4 pb-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              Color
              <input
                aria-label="Ambient video glow color"
                type="color"
                value={
                  settings.ambientVideoGlowColor === "auto"
                    ? DEFAULT_GLOW_PICKER_COLOR
                    : settings.ambientVideoGlowColor
                }
                onChange={(event) =>
                  updateSettings({ ambientVideoGlowColor: event.currentTarget.value })
                }
              />
            </label>
            <Button
              size="xs"
              type="button"
              variant="ghost"
              onClick={() => updateSettings({ ambientVideoGlowColor: "auto" })}
            >
              Use accent
            </Button>
            <label className="flex items-center gap-2">
              Intensity
              <input
                aria-label="Ambient video glow intensity"
                max="1"
                min="0.05"
                step="0.05"
                type="range"
                value={settings.ambientVideoGlowOpacity}
                onChange={(event) =>
                  updateSettings({
                    ambientVideoGlowOpacity: Number(event.currentTarget.value),
                  })
                }
              />
              {Math.round(settings.ambientVideoGlowOpacity * 100)}%
            </label>
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="Reset ambient video"
        description="Turn the player off and restore its presentation, layout, and glow defaults."
        resetAction={
          <SettingResetButton
            label="ambient video"
            onClick={() =>
              updateSettings({
                ambientVideoEnabled: DEFAULT_AMBIENT_VIDEO_ENABLED,
                ambientVideoSource: DEFAULT_AMBIENT_VIDEO_SOURCE,
                ambientVideoLayoutMode: DEFAULT_AMBIENT_VIDEO_LAYOUT_MODE,
                ambientVideoPresetPlacement: DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
                ambientVideoPresetSize: DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
                ambientVideoPresentationMode: DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
                ambientVideoGlowEnabled: DEFAULT_AMBIENT_VIDEO_GLOW_ENABLED,
                ambientVideoGlowColor: DEFAULT_AMBIENT_COLOR,
                ambientVideoGlowOpacity: DEFAULT_AMBIENT_OPACITY,
              })
            }
          />
        }
      />
    </SettingsSection>
  );
}
