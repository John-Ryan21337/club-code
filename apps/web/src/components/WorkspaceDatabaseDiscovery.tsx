import type { EnvironmentApi, EnvironmentId, ProjectId } from "@cafecode/contracts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { readEnvironmentConnection, subscribeEnvironmentConnections } from "~/environments/runtime";
import { Button } from "./ui/button";

type Connection = NonNullable<ReturnType<typeof readEnvironmentConnection>>;
type Result = Awaited<ReturnType<NonNullable<EnvironmentApi["workspaceObservatory"]>["databases"]>>;
interface Props {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly connection: Connection;
  readonly onSelect: (relativePath: string) => void;
}

export function WorkspaceDatabaseDiscovery(props: Props) {
  return (
    <DiscoverySession key={JSON.stringify([props.environmentId, props.projectId])} {...props} />
  );
}

function DiscoverySession({ environmentId, projectId, connection, onSelect }: Props) {
  const currentConnection = useSyncExternalStore(subscribeEnvironmentConnections, () =>
    readEnvironmentConnection(environmentId),
  );
  const owner = useRef(connection);
  const alive = useRef(true);
  const admission = useRef(false);
  const cancelWait = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const [result, setResult] = useState<{ value: Result; request: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
      cancelWait.current?.();
    };
  }, []);
  const connected = currentConnection === owner.current && connection === owner.current;
  const current = () =>
    alive.current &&
    connection === owner.current &&
    readEnvironmentConnection(environmentId) === owner.current;

  async function scan() {
    if (!current() || admission.current) return;
    admission.current = true;
    const request = ++generation.current;
    setBusy(true);
    setResult(null);
    setFailed(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const api = ensureEnvironmentApi(environmentId).workspaceObservatory;
      if (!api?.databases || !current()) throw new Error("unavailable");
      const response = await Promise.race([
        api.databases({ projectId }),
        new Promise<never>((_resolve, reject) => {
          cancelWait.current = () => reject(new Error("closed"));
          timer = setTimeout(() => reject(new Error("deadline")), 20_000);
        }),
      ]);
      if (current() && generation.current === request) setResult({ value: response, request });
    } catch {
      if (current() && generation.current === request) setFailed(true);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      cancelWait.current = null;
      if (generation.current === request) {
        admission.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }

  return (
    <section
      className="mb-4 min-w-0 rounded-xl border border-border/70 p-3"
      aria-label="Find project databases / プロジェクトのDB検索"
    >
      <Button
        size="sm"
        variant="outline"
        className="max-w-full whitespace-normal"
        disabled={!connected || busy}
        onClick={() => void scan()}
      >
        Find SQLite files / SQLite を探す
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Scan this project within fixed limits. Select a result to open its read-only viewer. /
        上限付きでこのプロジェクトを検索します。結果を選ぶと読み取り専用の表示を開きます。
      </p>
      {!connected ? (
        <p role="status" className="mt-2 text-xs">
          Connection changed. Reopen the observatory. /
          接続が変わりました。観測画面を開き直してください。
        </p>
      ) : (
        <>
          {busy ? (
            <p role="status" className="mt-2 text-xs">
              Scanning… / 検索中…
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              The scan was refused or timed out. Retry when the project is available. /
              検索が拒否されたか、時間切れになりました。プロジェクトを利用できるときに再試行してください。
            </p>
          ) : null}
          {result ? (
            <>
              <p className="mt-2 text-xs">Found / 検出: {result.value.databases.length}</p>
              {result.value.databases.length === 0 ? (
                <p className="mt-2 text-xs">
                  No SQLite files found within scan limits. / 検索範囲内で SQLite
                  ファイルが見つかりませんでした。
                </p>
              ) : (
                <ul
                  className="mt-2 max-h-52 space-y-1 overflow-auto"
                  aria-label="SQLite results / SQLite 検索結果"
                >
                  {result.value.databases.map(({ relativePath }) => (
                    <li key={relativePath}>
                      <button
                        type="button"
                        className="w-full break-all whitespace-pre-wrap rounded border border-border px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          if (
                            current() &&
                            !admission.current &&
                            result.request === generation.current
                          )
                            onSelect(relativePath);
                        }}
                      >
                        {relativePath}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {result.value.truncated ? (
                <p className="mt-2 text-xs">
                  Scan is partial. A limit or unreadable path may have stopped it. /
                  検索結果は一部です。上限や読み取れないパスで終了した場合があります。
                </p>
              ) : null}
              {result.value.redacted ? (
                <p className="mt-2 text-xs">
                  Some paths were withheld. / 一部のパスは表示しません。
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
