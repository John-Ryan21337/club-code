import { useEffect, useRef, useState } from "react";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import {
  disconnectYouTubeAccount,
  getYouTubeAccountConnectionStatus,
  startYouTubeAccountConnection,
  listYouTubeOwnedPlaylists,
  isYouTubeAccountAbort,
  YouTubeAccountConnectionRequestError,
  type YouTubeOwnedPlaylist,
} from "../../youtubeAccountConnection";
import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";

type Connection = ReturnType<typeof getPrimaryEnvironmentConnection>;
function readConnection(): Connection | null {
  try {
    return getPrimaryEnvironmentConnection();
  } catch {
    return null;
  }
}
type Action = "check" | "connect" | "playlists" | "disconnect";
const CHANGED =
  "The connection changed. Check the current connection before another account action.";

interface YouTubeAccountSettingsProps {
  readonly environmentScopeKey: string;
  readonly onSelect: (source: { readonly kind: "playlist"; readonly id: string }) => void;
}

/** A new scope must not paint the previous scope's private playlist titles. */
export function YouTubeAccountSettings(props: YouTubeAccountSettingsProps) {
  return <YouTubeAccountSettingsPanel key={props.environmentScopeKey} {...props} />;
}

/** No mount-time request or polling: each account operation requires its own button press. */
function YouTubeAccountSettingsPanel({
  environmentScopeKey,
  onSelect,
}: YouTubeAccountSettingsProps) {
  const [status, setStatus] = useState("Connection has not been checked.");
  const [playlists, setPlaylists] = useState<readonly YouTubeOwnedPlaylist[]>([]);
  const [busy, setBusy] = useState(false);
  const currentConnection = readConnection();
  const viewConnection = useRef<Connection | null>(currentConnection);
  const resultConnection = useRef<Connection | null>(null);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const displayedPlaylists =
    currentConnection !== null && resultConnection.current === currentConnection ? playlists : [];
  const displayedStatus = viewConnection.current === currentConnection ? status : CHANGED;

  useEffect(() => {
    revision.current += 1;
    request.current?.abort();
    request.current = null;
    resultConnection.current = null;
    viewConnection.current = readConnection();
    setPlaylists([]);
    setBusy(false);
    setStatus("Connection has not been checked.");
    return () => {
      revision.current += 1;
      request.current?.abort();
      request.current = null;
    };
  }, [environmentScopeKey]);

  const run = async (action: Action) => {
    if (request.current !== null) return;
    const connection = readConnection();
    if (connection === null || connection !== viewConnection.current) {
      viewConnection.current = connection;
      resultConnection.current = null;
      setPlaylists([]);
      setStatus(CHANGED);
      return;
    }
    const controller = new AbortController();
    const generation = ++revision.current;
    request.current = controller;
    resultConnection.current = null;
    setPlaylists([]);
    setBusy(true);
    setStatus("Waiting for the account connector…");
    const isCurrent = () => revision.current === generation && !controller.signal.aborted;
    try {
      if (action === "playlists") {
        const found = await listYouTubeOwnedPlaylists(controller.signal);
        if (!isCurrent()) return;
        if (readConnection() !== connection) {
          setStatus(CHANGED);
          return;
        }
        resultConnection.current = connection;
        setPlaylists(found);
        setStatus(
          found.length
            ? "Owned playlists loaded. Choose one to replace the current player queue."
            : "No owned playlists were returned.",
        );
      } else {
        const state =
          action === "disconnect"
            ? await disconnectYouTubeAccount(controller.signal).then(() => "disconnected" as const)
            : action === "connect"
              ? await startYouTubeAccountConnection(controller.signal)
              : await getYouTubeAccountConnectionStatus(controller.signal);
        if (!isCurrent()) return;
        if (readConnection() !== connection) {
          setStatus(CHANGED);
          return;
        }
        setStatus(
          state === "connected"
            ? "A connection is saved in this Cafe server session. This is not a live access check. Load my playlists to request data."
            : state === "pending"
              ? "Complete consent in the system browser, then press Check connection."
              : action === "disconnect"
                ? "This Cafe session was disconnected. Google's saved permission was not removed."
                : "No connection is saved in this Cafe server session.",
        );
      }
    } catch (error) {
      if (!isCurrent() || isYouTubeAccountAbort(error)) return;
      setStatus(
        readConnection() !== connection
          ? CHANGED
          : error instanceof YouTubeAccountConnectionRequestError
            ? error.message
            : "The YouTube account request failed.",
      );
    } finally {
      if (request.current === controller) request.current = null;
      if (revision.current === generation) setBusy(false);
    }
  };

  const select = (playlist: YouTubeOwnedPlaylist) => {
    if (resultConnection.current === null || readConnection() !== resultConnection.current) {
      resultConnection.current = null;
      setPlaylists([]);
      setStatus(CHANGED);
      return;
    }
    try {
      onSelect({ kind: "playlist", id: playlist.id });
    } catch {
      setStatus("The player could not load this playlist. Check the server connection.");
    }
  };

  return (
    <SettingsRow
      title="YouTube account playlists"
      description="Optional owner-only connection on a local Cafe server. Connect opens the system browser for Google consent. Grants stay in server memory; reconnect after a server restart."
    >
      <div className="flex flex-wrap gap-2 py-3">
        <Button disabled={busy} onClick={() => void run("check")}>
          Check connection
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => void run("connect")}>
          Connect YouTube
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => void run("playlists")}>
          Load my playlists
        </Button>
        <Button disabled={busy} variant="outline" onClick={() => void run("disconnect")}>
          Disconnect YouTube
        </Button>
        {busy ? (
          <Button
            variant="outline"
            onClick={() => {
              revision.current += 1;
              request.current?.abort();
              request.current = null;
              setBusy(false);
              setStatus(
                "Stopped waiting. A connection or disconnect already accepted by the server can still finish. Check connection before another action.",
              );
            }}
          >
            Stop waiting
          </Button>
        ) : null}
      </div>
      <p role="status" className="pb-3 text-xs text-muted-foreground">
        {displayedStatus}
      </p>
      <p className="pb-3 text-xs text-muted-foreground">
        Only the first 50 owned playlists are requested. This is not watch history or a complete
        library. Disconnect clears this Cafe session; remove Google's saved permission separately in
        your Google account settings.
      </p>
      {displayedPlaylists.length ? (
        <ul aria-label="Owned YouTube playlists" className="grid gap-2 pb-3">
          {displayedPlaylists.map((playlist) => (
            <li
              key={playlist.id}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border p-2"
            >
              <span className="min-w-0 flex-1 break-words text-xs [overflow-wrap:anywhere]">
                {playlist.title} · {playlist.itemCount} items
              </span>
              <Button variant="outline" className="shrink-0" onClick={() => select(playlist)}>
                Load owned playlist
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsRow>
  );
}
