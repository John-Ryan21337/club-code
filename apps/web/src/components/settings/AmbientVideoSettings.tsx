import { AmbientAudioCaptureControl } from "../ambient/AmbientAudioCaptureControl";
import { useEffect, useState, useSyncExternalStore } from "react";

import { parseYouTubeSource, youtubeSourceInputValue } from "../../ambientVideo";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { parseSpotifySource, spotifySourceInputValue } from "../../spotify";
import {
  youtubeQueueLibraryStore,
  YOUTUBE_QUEUE_LIBRARY_STORAGE_KEY,
} from "../../youtubeQueueLibrary";
import { youtubeUrlQueueStore } from "../../youtubeQueuePlayback";
import { useAmbientVideoWorkspace } from "../ambient/AmbientVideoWorkspace";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function AmbientVideoSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { environmentScopeKey, audioCaptureOwner } = useAmbientVideoWorkspace();
  const source = settings.ambientVideoSource;
  const sourceInput =
    source?.kind === "spotify" ? spotifySourceInputValue(source) : youtubeSourceInputValue(source);
  const [draft, setDraft] = useState(sourceInput);
  const [error, setError] = useState<string | null>(null);
  const library = useSyncExternalStore(
    youtubeQueueLibraryStore.subscribe,
    youtubeQueueLibraryStore.getSnapshot,
    youtubeQueueLibraryStore.getSnapshot,
  );
  useEffect(() => {
    setDraft(sourceInput);
    setError(null);
  }, [sourceInput, environmentScopeKey]);
  useEffect(() => {
    youtubeQueueLibraryStore.refresh();
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key === YOUTUBE_QUEUE_LIBRARY_STORAGE_KEY)
        youtubeQueueLibraryStore.refresh();
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  const loadSource = () => {
    const next = parseSpotifySource(draft) ?? parseYouTubeSource(draft);
    if (!next) {
      setError("Enter a supported YouTube or Spotify link.");
      return;
    }
    youtubeUrlQueueStore.stop();
    updateSettings({ ambientVideoSource: next, ambientVideoEnabled: true });
    setError(null);
  };

  return (
    <SettingsSection title="Streaming player">
      <SettingsRow
        title="Embedded playback"
        description="Loads the selected YouTube or Spotify embed. Playback stays in this workspace while you read chat or settings. The service may require you to press Play."
        control={
          <Switch
            aria-label="Enable streaming player"
            checked={settings.ambientVideoEnabled}
            onCheckedChange={(checked) => updateSettings({ ambientVideoEnabled: Boolean(checked) })}
          />
        }
      />
      <SettingsRow
        title="Shared audio analysis"
        description="Start only when you want to analyse audio from your chosen source. The capture stops when its player, source or environment changes."
      >
        <AmbientAudioCaptureControl owner={audioCaptureOwner} />
      </SettingsRow>
      <SettingsRow
        title="YouTube or Spotify link"
        description="Only the selected service ID is saved. The embed uses that service's own controls and account rules."
      >
        <div className="flex flex-wrap items-center gap-2 py-3">
          <Input
            nativeInput
            className="min-w-0 flex-1"
            aria-label="Streaming media link"
            value={draft}
            maxLength={2048}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <Button onClick={loadSource}>Load player</Button>
          <Button
            variant="outline"
            onClick={() => {
              youtubeUrlQueueStore.stop();
              updateSettings({ ambientVideoEnabled: false, ambientVideoSource: null });
            }}
          >
            Clear
          </Button>
        </div>
        {error ? (
          <p role="alert" className="pb-3 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </SettingsRow>
      <SettingsRow
        title="Cinema"
        description="Places the player beside chat when the window has enough space. Escape returns to the floating layout."
        control={
          <Switch
            aria-label="Streaming cinema mode"
            checked={settings.ambientVideoPresentationMode === "cinema"}
            onCheckedChange={(checked) =>
              updateSettings({ ambientVideoPresentationMode: checked ? "cinema" : "floating" })
            }
          />
        }
      />
      <SettingsRow
        title="Player glow"
        description="Adds an edge glow. Adaptive YouTube glow reads bounded public artwork; Spotify uses the fixed color."
        control={
          <Switch
            aria-label="Streaming player glow"
            checked={settings.ambientVideoGlowEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ ambientVideoGlowEnabled: Boolean(checked) })
            }
          />
        }
      />
      <SettingsRow
        title="Adaptive glow"
        description="Uses the edges of public YouTube artwork for the glow color."
        control={
          <Switch
            aria-label="Adaptive streaming glow"
            checked={settings.ambientVideoGlowMode === "adaptive"}
            onCheckedChange={(checked) =>
              updateSettings({ ambientVideoGlowMode: checked ? "adaptive" : "fixed" })
            }
          />
        }
      />
      <SettingsRow
        title="Play a saved YouTube queue"
        description="Import queues below. Play starts an in-memory session; it stops at the final video and does not restart after an app reload."
      >
        <div className="grid gap-2 py-3">
          {library.queues.length === 0 ? (
            <p className="text-xs text-muted-foreground">No queues are saved.</p>
          ) : (
            library.queues.map((queue) => (
              <div key={queue.name} className="flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-xs">
                  {queue.name} ({queue.videoIds.length})
                </span>
                <Button
                  aria-label={`Play queue ${queue.name}`}
                  onClick={() => {
                    youtubeUrlQueueStore.start(queue, environmentScopeKey);
                    updateSettings({ ambientVideoSource: null, ambientVideoEnabled: true });
                  }}
                >
                  Play
                </Button>
              </div>
            ))
          )}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
