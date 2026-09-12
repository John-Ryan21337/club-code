import { useEffect, useRef, useState, type FormEvent } from "react";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import {
  searchYouTube,
  isYouTubeDiscoveryAbort,
  YouTubeDiscoveryError,
  type YouTubeDiscoveryResult,
} from "../../youtubeDiscovery";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow } from "./settingsLayout";

type Connection = ReturnType<typeof getPrimaryEnvironmentConnection>;

export function YouTubeDiscoverySettings({
  environmentScopeKey,
  onSelect,
}: {
  readonly environmentScopeKey: string;
  readonly onSelect: (source: { readonly kind: "video" | "playlist"; readonly id: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly YouTubeDiscoveryResult[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const resultConnection = useRef<Connection | null>(null);
  const queryConnection = useRef<Connection | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    revision.current += 1;
    pending.current?.abort();
    pending.current = null;
    resultConnection.current = null;
    queryConnection.current = null;
    setQuery("");
    setResults([]);
    setStatus("");
    setBusy(false);
    return () => {
      revision.current += 1;
      pending.current?.abort();
      pending.current = null;
    };
  }, [environmentScopeKey]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current !== null) return;
    const connection = queryConnection.current;
    // Text entered for a previous server must not cross the new server's search boundary.
    try {
      if (connection === null || getPrimaryEnvironmentConnection() !== connection) {
        queryConnection.current = null;
        resultConnection.current = null;
        setQuery("");
        setResults([]);
        setStatus("The connection changed. Enter a new search on the current server.");
        return;
      }
    } catch {
      setStatus("YouTube search could not be reached.");
      return;
    }
    const isCurrentConnection = () => {
      try {
        return getPrimaryEnvironmentConnection() === connection;
      } catch {
        return false;
      }
    };
    const requestRevision = ++revision.current;
    const controller = new AbortController();
    pending.current = controller;
    resultConnection.current = null;
    setBusy(true);
    setResults([]);
    setStatus("Searching YouTube…");
    try {
      const found = await searchYouTube(query, { signal: controller.signal });
      if (revision.current !== requestRevision || controller.signal.aborted) return;
      if (!isCurrentConnection()) {
        setStatus("The connection changed. Search again on the current server.");
        return;
      }
      resultConnection.current = connection;
      setResults(found);
      setStatus(
        found.length === 0
          ? "No videos or playlists were found."
          : "Choose a result to load the player. Availability and playback are controlled by YouTube.",
      );
    } catch (error) {
      if (revision.current !== requestRevision || isYouTubeDiscoveryAbort(error)) return;
      if (!isCurrentConnection()) {
        setStatus("The connection changed. Search again on the current server.");
        return;
      }
      setStatus(
        error instanceof YouTubeDiscoveryError
          ? error.message
          : "YouTube search could not be reached.",
      );
    } finally {
      if (pending.current === controller) pending.current = null;
      if (revision.current === requestRevision) setBusy(false);
    }
  };

  const select = (result: YouTubeDiscoveryResult) => {
    try {
      if (getPrimaryEnvironmentConnection() !== resultConnection.current) {
        setResults([]);
        setStatus("The connection changed. Search again on the current server.");
        return;
      }
      onSelect({ kind: result.kind, id: result.id });
    } catch {
      setStatus("The player could not load this result. Check the server connection.");
    }
  };

  return (
    <SettingsRow
      title="Search public YouTube"
      description="When enabled by the server owner, Search sends this text to Google through your Cafe server. It uses the server's API quota. No account library or history is read."
    >
      <form onSubmit={(event) => void search(event)} className="flex flex-wrap gap-2 py-3">
        <Input
          nativeInput
          aria-label="Public YouTube search"
          className="min-w-0 flex-1"
          maxLength={120}
          value={query}
          disabled={busy}
          onChange={(event) => {
            const nextQuery = event.currentTarget.value;
            try {
              const connection = getPrimaryEnvironmentConnection();
              if (queryConnection.current !== null && queryConnection.current !== connection) {
                queryConnection.current = null;
                resultConnection.current = null;
                setQuery("");
                setResults([]);
                setStatus("The connection changed. Enter a new search on the current server.");
                return;
              }
              queryConnection.current = nextQuery.length === 0 ? null : connection;
            } catch {
              queryConnection.current = null;
            }
            setQuery(nextQuery);
          }}
        />
        <Button type="submit" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search"}
        </Button>
        {busy ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              revision.current += 1;
              pending.current?.abort();
              pending.current = null;
              setBusy(false);
              setStatus("Search cancelled.");
            }}
          >
            Cancel search
          </Button>
        ) : null}
      </form>
      {status ? (
        <p role="status" className="pb-3 text-xs text-muted-foreground">
          {status}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul aria-label="YouTube search results" className="grid gap-2 pb-3">
          {results.map((result) => (
            <li
              key={`${result.kind}:${result.id}`}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border p-2"
            >
              <span className="min-w-0 flex-1 break-words text-xs [overflow-wrap:anywhere]">
                {result.title}
              </span>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => select(result)}
              >
                Load {result.kind}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsRow>
  );
}
